// Platform abstraction. OS-specific logic stays here so callers
// never branch on process.platform.
import { execSync } from "node:child_process";

function log(msg) { console.error(`[platform] ${msg}`); }

export const SUPPORTED_PLATFORMS = new Set(["darwin", "win32"]);
export function isSupported() { return SUPPORTED_PLATFORMS.has(process.platform); }

// ── Screen geometry ────────────────────────────────────────────────────────
function getScreenGeometry_darwin(screenPref) {
  try {
    let selector;
    if (screenPref === "active") {
      selector = "const mouse=$.NSEvent.mouseLocation;const all=$.NSScreen.screens.js;for(const scr of all){const f=scr.frame;if(mouse.x>=f.origin.x&&mouse.x<f.origin.x+f.size.width&&mouse.y>=f.origin.y&&mouse.y<f.origin.y+f.size.height){s=scr;break}}if(!s)s=$.NSScreen.mainScreen;";
    } else {
      const idx = parseInt(screenPref, 10);
      selector = Number.isFinite(idx) && idx >= 1
        ? "const all=$.NSScreen.screens.js;s=all[" + (idx - 1) + "]||all[0];"
        : "s=$.NSScreen.screens.js[0];";
    }
    const script = "ObjC.import('AppKit');let s=null;" + selector + "if(!s||!s.frame)s=$.NSScreen.screens.js[0];const f=s.frame;const sa=(s.safeAreaInsets&&s.safeAreaInsets.top)||0;JSON.stringify({x:f.origin.x,y:f.origin.y,w:f.size.width,h:f.size.height,notch:sa})";
    const out = execSync("osascript -l JavaScript -e " + JSON.stringify(script), { encoding: "utf8", timeout: 1500 }).trim();
    const j = JSON.parse(out);
    if (Number.isFinite(j.w) && Number.isFinite(j.h)) {
      return { x: Math.round(j.x || 0), y: Math.round(j.y || 0), w: Math.round(j.w), h: Math.round(j.h), notch: Math.round(j.notch || 0) };
    }
  } catch (e) { log(`getScreenGeometry_darwin failed: ${e.message}`); }
  return { x: 0, y: 0, w: 1440, h: 900, notch: 0 };
}

function execPS(script) {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return execSync(`powershell -NoProfile -NoLogo -EncodedCommand ${encoded}`, {
    encoding: "utf8", timeout: 2000, windowsHide: true,
  }).trim();
}

function getScreenGeometry_win32(screenPref) {
  try {
    let psFilter;
    if (screenPref === "active") {
      psFilter = "$pos=[System.Windows.Forms.Cursor]::Position;$scr=[System.Windows.Forms.Screen]::AllScreens|Where-Object{$_.Bounds.Contains($pos)}|Select-Object -First 1;if(-not$scr){$scr=[System.Windows.Forms.Screen]::PrimaryScreen}";
    } else {
      const idx = parseInt(screenPref, 10);
      psFilter = Number.isFinite(idx) && idx >= 1
        ? "$all=[System.Windows.Forms.Screen]::AllScreens;$scr=if($all.Length -ge " + idx + "){$all[" + (idx - 1) + "]}else{$all[0]}"
        : "$scr=[System.Windows.Forms.Screen]::PrimaryScreen";
    }
    const script = "Add-Type -AssemblyName System.Windows.Forms;" + psFilter + ";$b=$scr.Bounds;$wa=$scr.WorkingArea;ConvertTo-Json @{x=$b.X;y=$b.Y;w=$b.Width;h=$b.Height;taskbarH=$b.Height-$wa.Height}";
    const j = JSON.parse(execPS(script));
    if (Number.isFinite(j.w) && Number.isFinite(j.h)) {
      return { x: Math.round(j.x || 0), y: Math.round(j.y || 0), w: Math.round(j.w), h: Math.round(j.h), notch: 0 };
    }
  } catch (e) { log(`getScreenGeometry_win32 failed: ${e.message}`); }
  return { x: 0, y: 0, w: 1920, h: 1080, notch: 0 };
}

export function getScreenGeometry(screenPref) {
  if (process.platform === "darwin") return getScreenGeometry_darwin(screenPref);
  if (process.platform === "win32") return getScreenGeometry_win32(screenPref);
  return { x: 0, y: 0, w: 1920, h: 1080, notch: 0 };
}

export function computeWindowPosition(screenGeo, winW, winH) {
  const x = Math.round(screenGeo.x + (screenGeo.w - winW) / 2);
  if (process.platform === "win32") return { x, y: screenGeo.y };
  return { x, y: Math.round(screenGeo.y + screenGeo.h - winH) };
}

export function getScreenCount() {
  try {
    if (process.platform === "darwin") {
      const out = execSync('osascript -l JavaScript -e "ObjC.import(\'AppKit\');$.NSScreen.screens.js.length"', { encoding: "utf8", timeout: 1500 }).trim();
      const n = parseInt(out, 10);
      if (Number.isFinite(n) && n >= 1) return Math.min(n, 9);
    }
    if (process.platform === "win32") {
      const n = parseInt(execPS("Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.Screen]::AllScreens.Length"), 10);
      if (Number.isFinite(n) && n >= 1) return Math.min(n, 9);
    }
  } catch (e) { log(`getScreenCount failed: ${e.message}`); }
  return 1;
}

export function resolveNotchMode(notchPref, notchH) {
  if (process.platform === "win32") return "normal";
  if (notchPref === "normal") return "normal";
  if (notchPref === "notch") return "notch";
  return notchH > 0 ? "notch" : "normal";
}
