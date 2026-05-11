// IPC path shared by companion daemon and bridge client.
// macOS / Linux: Unix domain socket at ~/.claude/claude-island.sock
// Windows:       Named pipe at \\.\pipe\claude-island

import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

if (process.platform !== "win32") {
  const dir = join(homedir(), ".claude");
  try { mkdirSync(dir, { recursive: true }); } catch {}
}

export const SOCK = process.platform === "win32"
  ? "//./pipe/claude-island"
  : join(homedir(), ".claude", "claude-island.sock");
