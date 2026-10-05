/* Copyright (C) 2026 Davide Leopardi
 * SPDX-License-Identifier: GPL-3.0-only */

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
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
  const root = path.resolve(__dirname, ".."),
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), "branchline-notices-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const directory = path.join(temporary, "resources", "licenses");
  fs.mkdirSync(directory, { recursive: true });
  for (const [source, target] of [
    [
      process.platform === "darwin" ? "LICENSE" : "LICENSE.electron.txt",
      "LICENSE.electron.txt",
    ],
    ["LICENSES.chromium.html", "LICENSES.chromium.html"],
  ])
    fs.copyFileSync(
      path.join(root, "node_modules", "electron", "dist", source),
      path.join(directory, target),
    );
  const platform = process.platform === "win32" ? "win32" : "linux",
    electronVersion = require("../package.json").devDependencies.electron;
  assert.equal(
    verifyElectronNotices(temporary, { platform, electronVersion }).licenses
      .length,
    2,
  );
  fs.writeFileSync(path.join(directory, "LICENSE.electron.txt"), "tampered");
  assert.throws(
    () => verifyElectronNotices(temporary, { platform, electronVersion }),
    /does not match/,
  );
});

test("afterExtract reads the actual Linux distribution notice name", async (t) => {
  const root = path.resolve(__dirname, ".."),
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), "branchline-extract-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  fs.mkdirSync(path.join(temporary, "resources"));
  for (const [source, target] of [
    [
      process.platform === "darwin" ? "LICENSE" : "LICENSE.electron.txt",
      "LICENSE.electron.txt",
    ],
    ["LICENSES.chromium.html", "LICENSES.chromium.html"],
  ])
    fs.copyFileSync(
      path.join(root, "node_modules", "electron", "dist", source),
      path.join(temporary, target),
    );
  const preserve = require("../scripts/preserve-electron-notices.cjs");
  const electronVersion = require("../package.json").devDependencies.electron;
  if (process.platform === "win32") {
    // The Windows Chromium notice is intentionally a different upstream file.
    // Verify the common filename branch without accepting foreign Linux bytes.
    await assert.rejects(
      preserve({
        packager: {
          projectDir: root,
          info: { framework: { version: electronVersion } },
        },
        arch: "x64",
        electronPlatformName: "linux",
        appOutDir: temporary,
      }),
      /reviewed upstream hash/,
    );
  } else {
    await preserve({
      packager: {
        projectDir: root,
        info: { framework: { version: electronVersion } },
      },
      arch: "x64",
      electronPlatformName: "linux",
      appOutDir: temporary,
    });
    assert.equal(
      verifyElectronNotices(temporary, {
        platform: "linux",
        arch: "x64",
        electronVersion,
      }).licenses.length,
      2,
    );
  }
});
