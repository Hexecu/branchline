/* Copyright (C) 2026 Davide Leopardi
 * SPDX-License-Identifier: GPL-3.0-only */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { packageMac } = require("./package-macos.cjs");
const { verifyDesktop } = require("./verify-desktop.cjs");
const root = path.resolve(__dirname, "..");
const version = require("../package.json").version;

function packageDesktop({
  outputDir = process.env.BRANCHLINE_PACKAGE_OUTPUT,
  buildRenderer = true,
} = {}) {
  if (
    !["darwin", "win32", "linux"].includes(process.platform) ||
    !["x64", "arm64"].includes(process.arch)
  )
    throw new Error(
      "Desktop builds require macOS, Windows or glibc Linux on x64 or arm64.",
    );
  let output = path.resolve(
    outputDir ||
      path.join(
        os.tmpdir(),
        "Branchline",
        "build",
        `v${version}-${process.platform}-${process.arch}`,
      ),
  );
  fs.mkdirSync(output, { recursive: true });
  // Native module loaders report canonical paths (for example /private/var on
  // macOS). Keep strict package/native verification on that same owned path.
  output = fs.realpathSync(output);
  let bundle;
  if (process.platform === "darwin")
    bundle = packageMac({ outputDir: output, buildRenderer }).bundle;
  else {
    if (buildRenderer)
      execFileSync(
        process.execPath,
        [require.resolve("typescript/bin/tsc"), "--noEmit"],
        { cwd: root, stdio: "inherit" },
      );
    if (buildRenderer)
      execFileSync(
        process.execPath,
        [path.join(root, "node_modules/vite/bin/vite.js"), "build"],
        { cwd: root, stdio: "inherit" },
      );
    execFileSync(
      process.execPath,
      [
        "--require",
        path.join(root, "scripts/builder-download.cjs"),
        require.resolve("electron-builder/out/cli/cli.js"),
        process.platform === "win32" ? "--win" : "--linux",
        "dir",
        `--${process.arch}`,
        "--publish",
        "never",
        `--config.directories.output=${output}`,
        ...(process.env.ELECTRON_BUILDER_CACHE
          ? [
              `--config.electronDownload.cache=${path.join(path.resolve(process.env.ELECTRON_BUILDER_CACHE), "electron")}`,
            ]
          : []),
      ],
      {
        cwd: root,
        stdio: "inherit",
        env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
      },
    );
    bundle = path.join(
      output,
      process.platform === "win32"
        ? process.arch === "x64"
          ? "win-unpacked"
          : `win-${process.arch}-unpacked`
        : process.arch === "x64"
          ? "linux-unpacked"
          : `linux-${process.arch}-unpacked`,
    );
  }
  const result = verifyDesktop(bundle, {
    probeNative: true,
    verifySource: true,
  });
  fs.writeFileSync(
    path.join(output, "desktop-verification.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) {
  try {
    packageDesktop();
  } catch (error) {
    console.error("Desktop package failed:", error.message);
    process.exitCode = 1;
  }
}
module.exports = { packageDesktop };
