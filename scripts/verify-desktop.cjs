/* Copyright (C) 2026 Davide Leopardi
 * SPDX-License-Identifier: GPL-3.0-only */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const asar = require("@electron/asar");
const { verifyPackage, verifyProjectLicense } = require("./verify-package.cjs");
const root = path.resolve(__dirname, "..");
const hash = (data) => crypto.createHash("sha256").update(data).digest("hex");

function sourceFiles(directory = root) {
  const entries = [
    "LICENSE",
    "COPYRIGHT",
    "THIRD_PARTY_NOTICES.md",
    "scripts/demo.cjs",
  ];
  const visit = (relative) => {
    for (const item of fs.readdirSync(path.join(directory, relative), {
      withFileTypes: true,
    })) {
      const entry = `${relative}/${item.name}`;
      if (item.isDirectory()) visit(entry);
      else if (item.isFile()) entries.push(entry);
      else throw new Error(`Source entries must be regular files: ${entry}`);
    }
  };
  for (const relative of ["electron", "locales", "dist", "assets"])
    visit(relative);
  return entries;
}

function noticeSnapshot(sourceRoot, platform, arch, electronVersion) {
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(sourceRoot, "assets", "electron-notices.json"),
      "utf8",
    ),
  );
  const expected = JSON.parse(
    fs.readFileSync(path.join(sourceRoot, "package.json"), "utf8"),
  ).devDependencies?.electron;
  const snapshot =
    manifest.version === 2 && manifest.distributions?.[`${platform}-${arch}`];
  if (
    !snapshot ||
    manifest.electronVersion !== expected ||
    electronVersion !== expected ||
    !/^[a-f\d]{64}$/.test(snapshot.upstreamArchiveSha256)
  )
    throw new Error(
      "Packaged Electron version/architecture does not match the reviewed notice snapshot.",
    );
  return snapshot;
}

function electronLicensesDirectory(
  bundle,
  { create = false, platform = process.platform } = {},
) {
  const ancestors =
    platform === "darwin"
      ? ["", "Contents", "Contents/Resources"]
      : ["", "resources"];
  for (const relative of ancestors)
    if (!fs.lstatSync(path.join(bundle, relative)).isDirectory())
      throw new Error("Electron notice ancestors must be real directories.");
  const directory = path.join(
    bundle,
    ...ancestors.at(-1).split("/"),
    "licenses",
  );
  if (create && !fs.existsSync(directory)) fs.mkdirSync(directory);
  if (
    !fs.lstatSync(directory).isDirectory() ||
    !fs.realpathSync(directory).startsWith(fs.realpathSync(bundle) + path.sep)
  )
    throw new Error(
      "Electron notices must remain inside the application bundle.",
    );
  return directory;
}

function verifyElectronNotices(
  bundle,
  {
    sourceRoot = root,
    arch = process.arch,
    platform = process.platform,
    electronVersion,
  } = {},
) {
  const snapshot = noticeSnapshot(sourceRoot, platform, arch, electronVersion),
    directory = electronLicensesDirectory(bundle, { platform });
  const licenses = ["LICENSE.electron.txt", "LICENSES.chromium.html"].map(
    (name) => {
      const file = path.join(directory, name),
        expected = snapshot.licenses?.[name];
      if (!fs.lstatSync(file).isFile())
        throw new Error(`Electron notice must be a regular file: ${name}`);
      const data = fs.readFileSync(file);
      if (
        !expected ||
        data.length !== expected.bytes ||
        hash(data) !== expected.sha256
      )
        throw new Error(
          `Electron notice does not match reviewed upstream bytes: ${name}`,
        );
      return { name, bytes: data.length, sha256: expected.sha256 };
    },
  );
  return {
    electronVersion,
    upstreamArchiveSha256: snapshot.upstreamArchiveSha256,
    licenses,
  };
}

function binaryArchitecture(filename) {
  const data = fs.readFileSync(filename);
  if (data.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    if (data.length < 20 || data[4] !== 2 || ![1, 2].includes(data[5]))
      throw new Error("Expected a 64-bit ELF executable.");
    const machine =
      data[5] === 1 ? data.readUInt16LE(18) : data.readUInt16BE(18);
    return machine === 62 ? "x64" : machine === 183 ? "arm64" : "unknown";
  }
  if (data.toString("ascii", 0, 2) === "MZ") {
    if (data.length < 64) throw new Error("Invalid PE header.");
    const offset = data.readUInt32LE(0x3c);
    if (offset > data.length - 6) throw new Error("Invalid PE header.");
    if (data.toString("ascii", offset, offset + 4) !== "PE\u0000\u0000")
      throw new Error("Invalid PE signature.");
    const machine = data.readUInt16LE(offset + 4);
    return machine === 0x8664
      ? "x64"
      : machine === 0xaa64
        ? "arm64"
        : "unknown";
  }
  const magic = data.length >= 8 ? data.readUInt32LE(0) : 0;
  if (magic === 0xfeedfacf) {
    const cpu = data.readUInt32LE(4);
    return cpu === 0x1000007 ? "x64" : cpu === 0x100000c ? "arm64" : "unknown";
  }
  return "unknown";
}

function layout(bundle, platform = process.platform) {
  if (platform === "darwin")
    return {
      executable: path.join(bundle, "Contents", "MacOS", "Branchline"),
      resources: path.join(bundle, "Contents", "Resources"),
    };
  return {
    executable: path.join(
      bundle,
      platform === "win32" ? "Branchline.exe" : "branchline",
    ),
    resources: path.join(bundle, "resources"),
  };
}

function verifyDesktop(
  bundlePath,
  { probeNative = false, verifySource = false, arch = process.arch } = {},
) {
  if (!["x64", "arm64"].includes(arch))
    throw new Error("Unsupported desktop architecture.");
  if (probeNative && arch !== process.arch)
    throw new Error(
      "Native runtime verification requires matching host and target architectures.",
    );
  const bundle = path.resolve(bundlePath),
    { executable, resources } = layout(bundle);
  if (binaryArchitecture(executable) !== arch)
    throw new Error("Packaged Electron executable has the wrong architecture.");
  const archive = path.join(resources, "app.asar");
  const packageData = JSON.parse(
    asar.extractFile(archive, "package.json").toString("utf8"),
  );
  verifyProjectLicense(packageData, (entry) =>
    asar.extractFile(archive, entry),
  );
  const sourceEntries = verifySource ? sourceFiles() : [];
  for (const entry of sourceEntries)
    if (
      !asar
        .extractFile(archive, entry)
        .equals(fs.readFileSync(path.join(root, entry)))
    )
      throw new Error(
        `Packaged source differs from the build checkout: ${entry}`,
      );
  for (const entry of [
    "dist/index.html",
    "electron/main.cjs",
    "electron/preload.cjs",
    "electron/platform.cjs",
    "locales/runtime.mjs",
  ])
    if (!asar.extractFile(archive, entry).length)
      throw new Error(`Missing packaged runtime: ${entry}`);
  const mac =
    process.platform === "darwin"
      ? verifyPackage(bundle, { probeNative: false })
      : {};
  let electronVersion = require("../package.json").devDependencies.electron;
  let nativePtyVerified = false;
  if (probeNative) {
    const probe = `
      const pty = require(${JSON.stringify(path.join(archive, "node_modules/node-pty"))});
      const windows = process.platform === 'win32';
      let output = '';
      const terminal = pty.spawn(windows ? (process.env.COMSPEC || 'cmd.exe') : '/bin/sh', windows ? ['/d', '/s', '/c', 'echo branchline-native-ok'] : ['-c', 'printf branchline-native-ok'], {cwd: require('node:os').tmpdir(), env: process.env, cols: 80, rows: 24});
      const timer = setTimeout(() => { terminal.kill(); process.exit(2); }, 10000);
      terminal.onData(data => { output += data; });
      terminal.onExit(({exitCode}) => {
        clearTimeout(timer);
        if (exitCode !== 0 || !output.includes('branchline-native-ok')) process.exit(3);
        console.log(JSON.stringify({arch:process.arch, electronVersion:process.versions.electron, binaries:Object.keys(require.cache).filter(name => name.endsWith('.node'))}));
      });
    `;
    const stdout = execFileSync(executable, ["-e", probe], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      encoding: "utf8",
      timeout: 20000,
    });
    const result = JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
    if (result.arch !== arch || !result.binaries?.length)
      throw new Error("Native PTY did not report its target architecture.");
    electronVersion = result.electronVersion;
    const unpacked =
      path.join(resources, "app.asar.unpacked", "node_modules", "node-pty") +
      path.sep;
    for (const entry of result.binaries) {
      const binary = path
        .normalize(entry)
        .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
      if (
        !path.resolve(binary).startsWith(unpacked) ||
        binaryArchitecture(binary) !== arch
      )
        throw new Error("PTY loaded a foreign or mismatched native binary.");
    }
    nativePtyVerified = true;
  }
  const notices = verifyElectronNotices(bundle, { arch, electronVersion });
  return {
    bundle,
    version: packageData.version,
    platform: process.platform,
    arch,
    projectLicenseVerified: true,
    sourceMatches: verifySource,
    sourceFilesChecked: sourceEntries.length,
    electronRuntimeVersionVerified: probeNative,
    ...notices,
    ...mac,
    nativePtyVerified,
  };
}

if (require.main === module) {
  try {
    console.log(
      JSON.stringify(
        verifyDesktop(process.argv[2], {
          probeNative: process.argv.includes("--native"),
        }),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error("Desktop verification failed:", error.message);
    process.exitCode = 1;
  }
}
module.exports = {
  binaryArchitecture,
  layout,
  verifyDesktop,
  sourceFiles,
  noticeSnapshot,
  electronLicensesDirectory,
  verifyElectronNotices,
};
