/* Copyright (C) 2026 Davide Leopardi
 * SPDX-License-Identifier: GPL-3.0-only */

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const {
  desktopPath,
  terminalShell,
  windowChrome,
} = require("../electron/platform.cjs");
const {
  binaryArchitecture,
  layout,
  noticeSnapshot,
  verifyElectronNotices,
} = require("../scripts/verify-desktop.cjs");

function noticeFixture(t) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "branchline-notices-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const sourceRoot = path.join(temporary, "project");
  fs.mkdirSync(path.join(sourceRoot, "assets"), { recursive: true });
  const electronVersion = require("../package.json").devDependencies.electron;
  const files = {
    "LICENSE.electron.txt": Buffer.from("Synthetic Electron notice\n"),
    "LICENSES.chromium.html": Buffer.from("<html>Synthetic Chromium notice</html>\n"),
  };
  const hash = (data) => crypto.createHash("sha256").update(data).digest("hex");
  const licenses = Object.fromEntries(
    Object.entries(files).map(([name, data]) => [
      name,
      { bytes: data.length, sha256: hash(data) },
    ]),
  );
  const distributions = {};
  for (const platform of ["darwin", "linux", "win32"])
    for (const arch of ["x64", "arm64"])
      distributions[`${platform}-${arch}`] = {
        upstreamArchiveSha256: hash(`synthetic-archive-${platform}-${arch}`),
        licenses,
      };
  fs.writeFileSync(
    path.join(sourceRoot, "package.json"),
    JSON.stringify({ devDependencies: { electron: electronVersion } }),
  );
  fs.writeFileSync(
    path.join(sourceRoot, "assets", "electron-notices.json"),
    JSON.stringify({ version: 2, electronVersion, distributions }),
  );
  return { temporary, sourceRoot, electronVersion, files };
}

test("Windows preserves drive-letter PATH entries and uses cmd without POSIX flags", () => {
  const env = {
    Path: "C:\\Program Files\\Git\\cmd;D:\\Tools",
    ComSpec: "C:\\Windows\\System32\\cmd.exe",
    SHELL: "/bin/bash",
  };
  assert.equal(desktopPath(env, "win32"), env.Path);
  assert.deepEqual(terminalShell(env, "win32"), {
    file: env.ComSpec,
    args: [],
  });
  assert.deepEqual(terminalShell({ SystemRoot: "D:\\Windows" }, "win32"), {
    file: "D:\\Windows\\System32\\cmd.exe",
    args: [],
  });
});

test("Unix shell fallback handles Linux without zsh and ignores absent configured shells", () => {
  const exists = (name) => name === "/bin/bash" || name === "/bin/sh";
  assert.deepEqual(terminalShell({ SHELL: "/removed/zsh" }, "linux", exists), {
    file: "/bin/bash",
    args: ["-l"],
  });
  assert.deepEqual(
    terminalShell({}, "linux", (name) => name === "/bin/sh"),
    { file: "/bin/sh", args: ["-l"] },
  );
  assert.deepEqual(
    terminalShell({ SHELL: "/custom/fish" }, "darwin", () => true),
    { file: "/custom/fish", args: ["-l"] },
  );
  assert.throws(
    () => terminalShell({ SHELL: "relative-shell" }, "linux", () => false),
    /No supported/,
  );
  assert.equal(
    desktopPath({ PATH: "/usr/bin:/usr/bin" }, "linux")
      .split(":")
      .filter((part) => part === "/usr/bin").length,
    1,
  );
  assert.ok(!desktopPath({}, "linux").includes("homebrew"));
});

test("native window controls remain available on Linux and Windows", () => {
  assert.deepEqual(windowChrome("win32"), { titleBarStyle: "default" });
  assert.deepEqual(windowChrome("linux"), { titleBarStyle: "default" });
  assert.equal(windowChrome("darwin").titleBarStyle, "hiddenInset");
  assert.equal(
    layout("/fixture", "linux").executable,
    path.join("/fixture", "branchline"),
  );
  assert.equal(
    layout("/fixture", "win32").executable,
    path.join("/fixture", "Branchline.exe"),
  );
});

test("package architecture checks read actual ELF, PE and Mach-O headers", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "branchline-arch-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  for (const arch of ["x64", "arm64"]) {
    for (const format of ["elf", "pe", "macho"]) {
      const data = Buffer.alloc(256);
      if (format === "elf") {
        Buffer.from([0x7f, 0x45, 0x4c, 0x46]).copy(data);
        data[4] = 2;
        data[5] = 1;
        data.writeUInt16LE(arch === "x64" ? 62 : 183, 18);
      } else if (format === "pe") {
        data.write("MZ");
        data.writeUInt32LE(128, 0x3c);
        data.write("PE\u0000\u0000", 128);
        data.writeUInt16LE(arch === "x64" ? 0x8664 : 0xaa64, 132);
      } else {
        data.writeUInt32LE(0xfeedfacf);
        data.writeUInt32LE(arch === "x64" ? 0x1000007 : 0x100000c, 4);
      }
      const file = path.join(temp, `${format}-${arch}`);
      fs.writeFileSync(file, data);
      assert.equal(binaryArchitecture(file), arch);
    }
  }
  const invalid = path.join(temp, "invalid");
  fs.writeFileSync(invalid, Buffer.alloc(256));
  assert.equal(binaryArchitecture(invalid), "unknown");
  fs.writeFileSync(invalid, Buffer.from("MZ"));
  assert.throws(() => binaryArchitecture(invalid), /Invalid PE/);
});

test("reviewed Electron notices cover six native targets and reject version drift", () => {
  const root = path.resolve(__dirname, ".."),
    electron = require("../package.json").devDependencies.electron;
  for (const platform of ["darwin", "linux", "win32"])
    for (const arch of ["x64", "arm64"])
      assert.match(
        noticeSnapshot(root, platform, arch, electron).upstreamArchiveSha256,
        /^[a-f\d]{64}$/,
      );
  assert.throws(
    () => noticeSnapshot(root, "linux", "arm64", "0.0.0"),
    /does not match/,
  );
  assert.throws(
    () => noticeSnapshot(root, "linux", "ia32", electron),
    /does not match/,
  );
});

test("packaged notices require exact reviewed bytes and reject tampering", (t) => {
  const fixture = noticeFixture(t);
  const bundle = path.join(fixture.temporary, "bundle");
  const directory = path.join(bundle, "resources", "licenses");
  fs.mkdirSync(directory, { recursive: true });
  for (const [name, contents] of Object.entries(fixture.files))
    fs.writeFileSync(path.join(directory, name), contents);
  const options = {
    sourceRoot: fixture.sourceRoot,
    platform: "linux",
    arch: "x64",
    electronVersion: fixture.electronVersion,
  };
  assert.equal(
    verifyElectronNotices(bundle, options).licenses.length,
    2,
  );
  const tampered = Buffer.from(fixture.files["LICENSE.electron.txt"]);
  tampered[0] ^= 1;
  fs.writeFileSync(path.join(directory, "LICENSE.electron.txt"), tampered);
  assert.throws(
    () => verifyElectronNotices(bundle, options),
    /does not match/,
  );
});

test("afterExtract reads renamed Linux and Windows notices and enforces upstream hashes", async (t) => {
  const fixture = noticeFixture(t);
  const preserve = require("../scripts/preserve-electron-notices.cjs");
  for (const platform of ["linux", "win32"]) {
    const bundle = path.join(fixture.temporary, platform);
    fs.mkdirSync(path.join(bundle, "resources"), { recursive: true });
    for (const [name, contents] of Object.entries(fixture.files))
      fs.writeFileSync(path.join(bundle, name), contents);
    assert.equal(fs.existsSync(path.join(bundle, "LICENSE")), false);
    const context = {
      packager: {
        projectDir: fixture.sourceRoot,
        info: { framework: { version: fixture.electronVersion } },
      },
      arch: "x64",
      electronPlatformName: platform,
      appOutDir: bundle,
    };
    await preserve(context);
    assert.equal(
      verifyElectronNotices(bundle, {
        sourceRoot: fixture.sourceRoot,
        platform,
        arch: "x64",
        electronVersion: fixture.electronVersion,
      }).licenses.length,
      2,
    );
    fs.writeFileSync(path.join(bundle, "LICENSES.chromium.html"), "tampered");
    await assert.rejects(preserve(context), /reviewed upstream hash/);
  }
});
