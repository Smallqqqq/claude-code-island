#!/usr/bin/env node
// Compiles the native host binary for the current platform.
//
// macOS:   swiftc hosts/macos/island-host.swift → island-host-bin
// Windows: dotnet publish hosts/windows/... → hosts/windows/island-host-win.exe
//
// Prerequisites:
//   macOS  — Xcode Command Line Tools (xcode-select --install)
//   Windows — .NET 8 SDK (winget install Microsoft.DotNet.SDK.8)

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function hasCommand(cmd, args = ["--version"]) {
  const r = spawnSync(cmd, args, { encoding: "utf8", stdio: "pipe" });
  return !r.error && r.status === 0;
}

function hasDotnetSdk() {
  const r = spawnSync("dotnet", ["--list-sdks"], { encoding: "utf8", stdio: "pipe" });
  return !r.error && r.status === 0 && Boolean(r.stdout.trim());
}

// ── macOS ────────────────────────────────────────────────────────────────
if (process.platform === "darwin") {
  const swiftFile = join(here, "hosts", "macos", "island-host.swift");
  const outputBin = join(here, "island-host-bin");

  if (!existsSync(swiftFile)) {
    console.error("[claude-island] Missing Swift source: " + swiftFile);
    process.exit(1);
  }

  if (!hasCommand("swiftc")) {
    console.error("[claude-island] swiftc not found. Install Xcode Command Line Tools:");
    console.error("    xcode-select --install");
    console.error("Then re-run this script.");
    process.exit(1);
  }

  console.log("[claude-island] Compiling macOS host...");
  const result = spawnSync("swiftc", ["-O", swiftFile, "-o", outputBin], { stdio: "inherit" });
  if (result.status !== 0) {
    console.error("[claude-island] swiftc failed with status " + result.status);
    process.exit(result.status ?? 1);
  }
  console.log("[claude-island] Built: " + outputBin);
  process.exit(0);
}

// ── Windows ──────────────────────────────────────────────────────────────
if (process.platform === "win32") {
  const csproj = join(here, "hosts", "windows", "island-host.csproj");
  const outDir = join(here, "hosts", "windows");
  const outputExe = join(outDir, "island-host-win.exe");

  if (!existsSync(csproj)) {
    console.error("[claude-island] Missing csproj: " + csproj);
    process.exit(1);
  }

  if (!hasDotnetSdk()) {
    console.error("[claude-island] .NET 8 SDK not found.");
    console.error("Install it with:  winget install Microsoft.DotNet.SDK.8");
    console.error("Then re-run this script.");
    process.exit(1);
  }

  console.log("[claude-island] Building Windows host (first run may take a minute)...");
  const rid = process.arch === "arm64" ? "win-arm64" : "win-x64";
  const result = spawnSync("dotnet", [
    "publish", csproj,
    "-c", "Release",
    "-r", rid,
    "--self-contained", "false",
    "-o", outDir,
    "--nologo",
  ], { stdio: "inherit" });

  if (result.status !== 0) {
    console.error("[claude-island] dotnet publish failed with status " + result.status);
    process.exit(result.status ?? 1);
  }

  if (!existsSync(outputExe)) {
    console.error("[claude-island] Build succeeded but exe not found at: " + outputExe);
    process.exit(1);
  }

  console.log("[claude-island] Built: " + outputExe);
  process.exit(0);
}

// ── Unsupported ──────────────────────────────────────────────────────────
console.log("[claude-island] Unsupported platform: " + process.platform + " — skipping build.");
process.exit(0);
