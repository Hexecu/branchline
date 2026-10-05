// Copyright (c) 2026 Davide Leopardi
// SPDX-License-Identifier: GPL-3.0-only

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Arch } = require("builder-util");
const {
  electronLicensesDirectory,
  noticeSnapshot,
} = require("./verify-desktop.cjs");

// Electron's macOS framework preparation removes its extracted notices before
// afterPack. Preserve them from this exact distribution in afterExtract, before
// renaming/signing, and require the source-controlled upstream hash snapshot.
module.exports = async (context) => {
  const project = context.packager.projectDir;
  const framework = context.packager.info.framework;
  const arch =
    typeof context.arch === "string" ? context.arch : Arch[context.arch];
  const platform = context.electronPlatformName;
  const manifest = noticeSnapshot(project, platform, arch, framework.version);
  const distributionApp = framework.distMacOsAppName;
  if (platform === "darwin" && !/^[A-Za-z0-9 ._-]+\.app$/.test(distributionApp))
    throw new Error("Unexpected extracted Electron bundle name.");
  const files = [
    [
      platform === "darwin" ? "LICENSE" : "LICENSE.electron.txt",
      "LICENSE.electron.txt",
    ],
    ["LICENSES.chromium.html", "LICENSES.chromium.html"],
  ].map(([source, target]) => {
    const filename = path.join(context.appOutDir, source);
    if (!fs.lstatSync(filename).isFile())
      throw new Error(
        `Electron notice is not a regular distribution file: ${source}`,
      );
    const contents = fs.readFileSync(filename),
      expected = manifest.licenses?.[target];
    const sha256 = crypto.createHash("sha256").update(contents).digest("hex");
    if (
      !expected ||
      !contents.length ||
      contents.length !== expected.bytes ||
      sha256 !== expected.sha256
    )
      throw new Error(
        `Electron distribution notice does not match the reviewed upstream hash: ${source}`,
      );
    return { target, contents };
  });
  const bundle =
    platform === "darwin"
      ? path.join(context.appOutDir, distributionApp)
      : context.appOutDir;
  const licenses = electronLicensesDirectory(bundle, {
    create: true,
    platform,
  });
  for (const { target, contents } of files)
    fs.writeFileSync(path.join(licenses, target), contents, {
      flag: "wx",
      mode: 0o644,
    });
};
