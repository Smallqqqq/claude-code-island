#!/usr/bin/env node
// claude-island companion daemon
// ===============================
// Single long-lived process that:
//   1. Owns a native WebView window at the top-center of the screen.
//   2. Runs a socket server for bridge clients to stream status updates.
//   3. Renders each connected session as its own pill row.
//
// Protocol (client → server, one JSON per line):
//   { id, type:"update", project, status, detail, prompt, ctxPct, startedAt, frozenElapsed }
//   { id, type:"remove" }
//   { id, type:"mode",    mode:"normal"|"notch" }
//   { id, type:"scale",   scale:"small"|"medium"|"large"|"xlarge" }
//   { id, type:"done-retract", delayMs: 5000 }   — auto-remove row after delay
//   { id, type:"respawn" }
//
// Persistent daemon — stays alive until explicitly killed.
// The island window remains visible as a permanent status bar.

import { createServer } from "node:net";
import { createInterface } from "node:readline";
import { existsSync, readFileSync, unlinkSync, mkdirSync, appendFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openFixed } from "./open-fixed.mjs";
import { buildIslandHTML } from "./island.html.mjs";
import { SOCK } from "./socket-path.mjs";
import { getScreenGeometry, computeWindowPosition, resolveNotchMode } from "./platform.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// ── Logging ────────────────────────────────────────────────────────────
// companion runs detached with stdio:"ignore", so we log to a file.
const LOG_FILE = join(homedir(), ".claude", "claude-island.log");
const MAX_LOG_SIZE = 256 * 1024; // 256KB, auto-truncate

function log(level, msg) {
  try {
    const ts = new Date().toISOString();
    appendFileSync(LOG_FILE, `[${ts}] [${level}] ${msg}\n`);
  } catch {}
}

// Rotate log if too large
try {
  if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > MAX_LOG_SIZE) {
    unlinkSync(LOG_FILE);
  }
} catch {}

log("info", `companion starting (pid=${process.pid}, platform=${process.platform})`);

// ── User preference (~/.claude/claude-island.json) ─────────────────────
const PREF_DIR  = join(homedir(), ".claude");
const PREF_FILE = join(PREF_DIR, "claude-island.json");

// Write PID file for precise process management
const PID_FILE = join(PREF_DIR, "claude-island.pid");
try { writeFileSync(PID_FILE, String(process.pid)); } catch {}
process.on("exit", () => { try { if (existsSync(PID_FILE)) unlinkSync(PID_FILE); } catch {} });

// ── Crash handlers ─────────────────────────────────────────────────────
process.on("uncaughtException", (err) => {
  log("fatal", `uncaughtException: ${err.message}\n${err.stack}`);
  cleanup();
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  log("error", `unhandledRejection: ${reason}`);
});

const VALID_STATUS = new Set([
  "thinking", "reading", "editing", "writing",
  "running",  "searching", "done",    "error", "waiting",
]);

function readPref() {
  try {
    if (!existsSync(PREF_FILE)) return {};
    const data = JSON.parse(readFileSync(PREF_FILE, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch (e) {
    log("warn", `readPref failed: ${e.message}`);
    return {};
  }
}

// ── Window setup ───────────────────────────────────────────────────────
const WIN_W = 640;
const WIN_H = 52; // minimal: fits ~1 row; grows with rows

const _pref = readPref();
const SCREEN_PREF = typeof _pref.screen === "string" && _pref.screen.length > 0 ? _pref.screen : "primary";
const NOTCH_PREF = (_pref.notchMode === "normal" || _pref.notchMode === "notch") ? _pref.notchMode : "auto";

log("info", `screenPref=${SCREEN_PREF} notchPref=${NOTCH_PREF}`);

const screenGeo = getScreenGeometry(SCREEN_PREF);
const { x, y } = computeWindowPosition(screenGeo, WIN_W, WIN_H);
const autoMode = resolveNotchMode(NOTCH_PREF, screenGeo.notch);

log("info", `screenGeo=${JSON.stringify(screenGeo)} windowPos=(${x},${y}) notchMode=${autoMode}`);

let win;
try {
  win = openFixed(buildIslandHTML(), {
    width: WIN_W, height: WIN_H, x, y,
    frameless: true, floating: true, transparent: true,
    clickThrough: true, noDock: true,
  });
} catch (e) {
  log("fatal", `openFixed failed: ${e.message}`);
  process.exit(1);
}

let winReady = false;
const MAX_PENDING = 200;
const pending = [];

function send(js) {
  if (winReady) {
    try { win.send(js); } catch (e) { log("warn", `win.send failed: ${e.message}`); }
  } else {
    if (pending.length < MAX_PENDING) pending.push(js);
    else log("warn", `pending overflow, dropping message`);
  }
}

win.on("ready", (info) => {
  winReady = true;
  log("info", `window ready: ${JSON.stringify(info)}`);
  send('window.island.setMode(' + JSON.stringify(autoMode) + ')');
  for (const js of pending.splice(0)) {
    try { win.send(js); } catch (e) { log("warn", `drain pending failed: ${e.message}`); }
  }
});
win.on("closed", () => {
  log("info", "window closed");
  cleanup();
  process.exit(0);
});
win.on("error", (e) => {
  log("error", `window error: ${e?.message || e}`);
});
win.on("message", (data) => {
  if (data && data.__debug) {
    log("debug", `[html] ${JSON.stringify(data)}`);
  }
});

// ── Socket server ──────────────────────────────────────────────────────
if (process.platform !== "win32" && existsSync(SOCK)) {
  try { unlinkSync(SOCK); } catch (e) { log("warn", `unlink SOCK failed: ${e.message}`); }
}
try { mkdirSync(PREF_DIR, { recursive: true }); } catch (e) { log("warn", `mkdir PREF_DIR failed: ${e.message}`); }

const clients = new Set();
const socketIds = new WeakMap();
const activeRowIds = new Set(); // tracked for dynamic window height
let idleTimer = null;
const doneTimers = new Map();
const ROW_TTL_MS = 120000; // auto-remove rows with no updates for 120s
const rowLastUpdate = new Map(); // id → timestamp

// Periodic check: remove rows that haven't been updated in ROW_TTL_MS.
// This handles Ctrl+C and other abnormal terminations where Stop/StopFailure
// hooks never fire. Normal done-retract handles graceful exits.
setInterval(() => {
  const now = Date.now();
  for (const [id, ts] of rowLastUpdate) {
    if (now - ts > ROW_TTL_MS) {
      log("info", `row TTL expired id=${id}`);
      rowLastUpdate.delete(id);
      clearDoneTimer(id);
      activeRowIds.delete(id);
      syncHeight();
      try { send('window.island.removeRow(' + JSON.stringify(id) + ')'); } catch {}
    }
  }
}, 10000);

function syncHeight() {
  const h = Math.max(52, activeRowIds.size * 36 + 8);
  try { win?.resize(WIN_W, h); } catch {}
}

function scheduleIdleExit() {
  // Don't auto-exit — keep island visible until explicitly killed.
  // The companion stays alive even after all clients disconnect,
  // so the island window remains visible as a persistent status bar.
  if (idleTimer) clearTimeout(idleTimer);
}

const server = createServer((sock) => {
  clients.add(sock);
  socketIds.set(sock, new Set());
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  log("info", `client connected (total=${clients.size})`);

  const rl = createInterface({ input: sock, crlfDelay: Infinity });
  rl.on("line", (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (!msg || typeof msg.type !== "string") return;
    if (typeof msg.id === "string" && msg.id) {
      socketIds.get(sock)?.add(msg.id);
    }

    if (msg.type === "update") {
      if (!msg.id || !VALID_STATUS.has(msg.status)) return;
      log("info", `update id=${msg.id} status=${msg.status} project=${msg.project||''} prompt="${(msg.prompt||'').substring(0,40)}"`);
      rowLastUpdate.set(msg.id, Date.now());
      // Cancel any pending done-retract timer — a new update means
      // the row is active again (e.g. new session reuses the same id).
      clearDoneTimer(msg.id);
      activeRowIds.add(msg.id);
      syncHeight();
      send('window.island.upsertRow(' + JSON.stringify(msg.id) + ',' + JSON.stringify(msg) + ')');
      return;
    }
    if (msg.type === "remove") {
      if (!msg.id) return;
      clearDoneTimer(msg.id);
      activeRowIds.delete(msg.id);
      syncHeight();
      log("info", `remove id=${msg.id}`);
      send('window.island.removeRow(' + JSON.stringify(msg.id) + ')');
      return;
    }
    if (msg.type === "done-retract") {
      if (!msg.id) return;
      const delay = typeof msg.delayMs === "number" ? msg.delayMs : 5000;
      log("info", `done-retract id=${msg.id} delay=${delay}ms`);
      scheduleDoneRetract(msg.id, delay);
      return;
    }
    if (msg.type === "mode" && (msg.mode === "normal" || msg.mode === "notch")) {
      send('window.island.setMode(' + JSON.stringify(msg.mode) + ')');
      return;
    }
    if (msg.type === "scale" && typeof msg.scale === "string") {
      send('window.island.setScale(' + JSON.stringify(msg.scale) + ')');
      return;
    }
    if (msg.type === "respawn") {
      log("info", "respawn requested");
      cleanup();
      process.exit(0);
      return;
    }
    if (msg.type === "eval" && typeof msg.js === "string") {
      log("info", `eval: ${msg.js.substring(0,80)}`);
      send(msg.js);
      return;
    }
  });

  sock.on("close", () => {
    clients.delete(sock);
    // IMPORTANT: Do NOT auto-remove rows on disconnect.
    // Unlike pi-island (which keeps a persistent socket per session),
    // claude-island's bridge is a one-shot process per hook invocation.
    // Removing rows on disconnect would cause "flash" — rows appear and
    // disappear instantly between hook calls.
    // Rows are only removed via done-retract (delayed) or explicit remove.
    const ids = socketIds.get(sock);
    if (ids) socketIds.delete(sock);
    log("info", `client disconnected (total=${clients.size})`);
    if (clients.size === 0) scheduleIdleExit();
  });
  sock.on("error", (e) => {
    log("warn", `socket error: ${e.message}`);
  });
});

function clearDoneTimer(id) {
  const t = doneTimers.get(id);
  if (t) { clearTimeout(t); doneTimers.delete(id); }
}

function scheduleDoneRetract(id, delayMs) {
  clearDoneTimer(id);
  const t = setTimeout(() => {
    doneTimers.delete(id);
    activeRowIds.delete(id);
    rowLastUpdate.delete(id);
    syncHeight();
    send('window.island.removeRow(' + JSON.stringify(id) + ')');
  }, delayMs);
  doneTimers.set(id, t);
}

server.on("error", (err) => {
  if (err?.code === "EADDRINUSE") {
    log("info", "EADDRINUSE — another companion is already running, exiting");
    cleanup();
    process.exit(0);
  }
  log("error", `server error: ${err?.message} (code=${err?.code})`);
  cleanup();
  process.exit(1);
});

server.listen(SOCK, () => {
  log("info", `listening on ${SOCK}`);
});

// ── Cleanup ────────────────────────────────────────────────────────────
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  log("info", "cleanup");
  // Clear all done timers
  for (const t of doneTimers.values()) clearTimeout(t);
  doneTimers.clear();
  try { server.close(); } catch (e) { log("warn", `server.close failed: ${e.message}`); }
  if (process.platform !== "win32") {
    try { if (existsSync(SOCK)) unlinkSync(SOCK); } catch (e) { log("warn", `unlink SOCK failed: ${e.message}`); }
  }
  try { win.close(); } catch (e) { log("warn", `win.close failed: ${e.message}`); }
}
process.on("SIGTERM", () => { cleanup(); process.exit(0); });
process.on("SIGINT",  () => { cleanup(); process.exit(0); });
process.on("exit", cleanup);
