/* Copyright (C) 2026 Davide Leopardi
 * SPDX-License-Identifier: GPL-3.0-only */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

function desktopPath(env = process.env, platform = process.platform) {
  if (platform === "win32") return env.PATH || env.Path || "";
  const extra = platform === "darwin" ? ["/opt/homebrew/bin"] : [];
  return [
    ...new Set([
      ...(env.PATH || "").split(path.posix.delimiter).filter(Boolean),
      ...extra,
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
    ]),
  ].join(path.posix.delimiter);
}

function terminalShell(
  env = process.env,
  platform = process.platform,
  exists = fs.existsSync,
) {
  if (platform === "win32") {
    const file =
      env.COMSPEC ||
      env.ComSpec ||
      path.win32.join(env.SystemRoot || "C:\\Windows", "System32", "cmd.exe");
    return { file, args: [] };
  }
  const candidates = [
    env.SHELL,
    ...(platform === "darwin" ? ["/bin/zsh"] : []),
    "/bin/bash",
    "/bin/sh",
  ];
  const file = candidates.find(
    (candidate) =>
      typeof candidate === "string" &&
      path.posix.isAbsolute(candidate) &&
      exists(candidate),
  );
  if (!file) throw new Error("No supported terminal shell is available.");
  return { file, args: ["-l"] };
}

function windowChrome(platform = process.platform) {
  return platform === "darwin"
    ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 14, y: 18 } }
    : { titleBarStyle: "default" };
}

module.exports = { desktopPath, terminalShell, windowChrome };
