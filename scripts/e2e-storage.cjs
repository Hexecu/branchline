// Copyright (c) 2026 Davide Leopardi
// SPDX-License-Identifier: GPL-3.0-only

"use strict";

// Real OS encryption, synthetic credentials only. Linux always creates a fresh
// D-Bus session and an unlocked, disposable GNOME keyring. macOS is deliberately
// excluded: its signing/Keychain acceptance requires separate supervision.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { randomBytes, createHash } = require("node:crypto");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { createRequire } = require("node:module");
const command = promisify(execFile);
let root = path.resolve(__dirname, "..");
const NATIVE_DEADLINE_MS = 8000;

function bounded(work, milliseconds, label) {
  let timer;
  return Promise.race([
    Promise.resolve().then(work),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded its deadline.`)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  try {
    await bounded(() => new Promise(resolve => child.once("exit", resolve)), 2000, "Owned process shutdown");
  } catch {
    child.kill("SIGKILL");
    await bounded(() => new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) resolve();
      else child.once("exit", resolve);
    }), 2000, "Owned process termination");
  }
}

async function isolatedLinux() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "tableline-native-storage-"));
  const directories = Object.fromEntries(["config", "data", "cache", "runtime"].map(name => [name, path.join(base, name)]));
  await Promise.all(Object.values(directories).map(directory => fs.mkdir(directory, { mode: 0o700 })));
  let child;
  try {
    const environment = {
      ...process.env,
      TABLELINE_STORAGE_FIXTURE_ROOT: base,
      TABLELINE_STORAGE_DBUS_SESSION: "1",
      XDG_CONFIG_HOME: directories.config,
      XDG_DATA_HOME: directories.data,
      XDG_CACHE_HOME: directories.cache,
      XDG_RUNTIME_DIR: directories.runtime,
      XDG_CURRENT_DESKTOP: "GNOME",
    };
    // The outer desktop session and all existing keyrings are intentionally absent.
    for (const name of ["DBUS_SESSION_BUS_ADDRESS", "GNOME_KEYRING_CONTROL", "GNOME_KEYRING_PID", "SSH_AUTH_SOCK"])
      delete environment[name];
    child = spawn("dbus-run-session", ["--", process.execPath, __filename, `--source-root=${root}`, "--linux-session"], {
      env: environment, stdio: ["ignore", "inherit", "inherit"],
    });
    const outcome = await bounded(() => new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    }), 90000, "Disposable native-storage session");
    if (outcome.code !== 0 || outcome.signal) throw new Error("Disposable native-storage session failed.");
  } finally {
    await stop(child);
    await fs.rm(base, { recursive: true, force: true });
  }
}

async function startKeyring(base) {
  const control = path.join(base, "keyring-control");
  await fs.mkdir(control, { mode: 0o700 });
  const daemon = spawn("gnome-keyring-daemon", ["--foreground", "--unlock", "--components=secrets", `--control-directory=${control}`], {
    env: { ...process.env, GNOME_KEYRING_CONTROL: control },
    stdio: ["pipe", "ignore", "ignore"],
  });
  let startupError;
  daemon.once("error", error => { startupError = error; });
  // The random fixture password goes only through stdin: never argv, env or disk.
  daemon.stdin.on("error", () => {});
  daemon.stdin.end(randomBytes(32).toString("hex"));
  try {
    await bounded(async () => {
      while (true) {
        if (startupError || daemon.exitCode !== null || daemon.signalCode !== null)
          throw new Error("Disposable Secret Service could not start.");
        const { stdout } = await command("dbus-send", [
          "--session", "--type=method_call", "--print-reply", "--dest=org.freedesktop.DBus",
          "/org/freedesktop/DBus", "org.freedesktop.DBus.NameHasOwner", "string:org.freedesktop.secrets",
        ], { timeout: 1000, maxBuffer: 4096 });
        if (/boolean\s+true/.test(stdout)) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }, NATIVE_DEADLINE_MS, "Disposable Secret Service initialization");
    return daemon;
  } catch (error) {
    await stop(daemon);
    throw error;
  }
}

async function scanFiles(directory, markers) {
  let files = 0;
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, item.name);
    if (item.isDirectory()) files += await scanFiles(filename, markers);
    else if (item.isFile()) {
      const bytes = await fs.readFile(filename);
      for (const marker of markers)
        assert.equal(bytes.includes(Buffer.from(marker)), false, "Synthetic credential reached disk as plaintext.");
      files++;
    }
  }
  return files;
}

async function acceptance() {
  const sourceRequire = createRequire(path.join(root, "package.json"));
  const applicationName = sourceRequire("./package.json").name;
  if (!["tableline", "branchline"].includes(applicationName)) throw new Error("Unsupported storage acceptance application.");
  const executablePath = process.env[`${applicationName.toUpperCase()}_E2E_EXECUTABLE`];
  const packaged = Boolean(executablePath);
  const reportFile = path.resolve(process.env.TABLELINE_STORAGE_REPORT || path.join(
    root, "artifacts", "e2e", "storage", `${packaged ? "packaged" : "source"}-${process.platform}-${process.arch}`, "report.json",
  ));
  const checks = [];
  const report = {
    application: applicationName, platform: process.platform, arch: process.arch, packaged,
    nativeCredentialAcceptance: false, nativeDeadlineMs: NATIVE_DEADLINE_MS,
    syntheticCredentialsOnly: true, rendererSandboxAcceptance: false, checks,
  };
  const ownsBase = process.platform !== "linux";
  const base = ownsBase
    ? await fs.mkdtemp(path.join(os.tmpdir(), "tableline-native-storage-"))
    : process.env.TABLELINE_STORAGE_FIXTURE_ROOT;
  if (!base || !path.isAbsolute(base) || !/^tableline-native-storage-[A-Za-z0-9]+$/.test(path.basename(base)))
    throw new Error("A disposable storage fixture directory is required.");
  const directory = path.join(base, "app-data");
  await fs.mkdir(directory, { mode: 0o700 });
  let application, daemon;
  const markers = ["native-storage-ai-" + randomBytes(24).toString("hex"), "native-storage-db-" + randomBytes(24).toString("hex"), "native-storage-legacy-" + randomBytes(24).toString("hex")];
  const identifiers = ["ai-native-qa", "db-native-qa", "ai-legacy-qa"];
  const expectedSource = createHash("sha256").update(await fs.readFile(path.join(root, "electron", "ai-vault.cjs"))).digest("hex");
  const check = async (name, work) => {
    const started = performance.now();
    try {
      await work();
      checks.push({ name, status: "passed", durationMs: Math.round(performance.now() - started) });
      console.log("PASS", name);
    } catch (error) {
      checks.push({
        name, status: "failed", error: "Native acceptance assertion failed; credential diagnostics are withheld.",
        ...(typeof error?.code === "string" && /^(?:ERR_ASSERTION|SECURE_STORAGE_TIMEOUT|SECURE_STORAGE_BLOCKED)$/.test(error.code)
          ? { code: error.code } : {}),
      });
      throw new Error(`Native-storage check failed: ${name}`);
    }
  };
  const evaluate = (callback, argument) => bounded(
    () => application.evaluate(callback, argument), NATIVE_DEADLINE_MS + 2000, "Native secure-storage operation",
  );
  const launch = async () => {
    const { _electron: electron } = sourceRequire("playwright");
    const launchEnv = {
      ...process.env, TABLELINE_DEV_URL: "", BRANCHLINE_DEV_URL: "",
      ...(applicationName === "branchline" ? { BRANCHLINE_DATA_DIR: directory } : {}),
    };
    delete launchEnv.ELECTRON_RUN_AS_NODE;
    application = await electron.launch({
      executablePath: executablePath || sourceRequire("electron"),
      args: [
        ...(packaged ? [] : [path.join(root, "electron", "main.cjs")]),
        `--${applicationName}-qa`, `--${applicationName}-data=${directory}`,
        ...(process.platform === "linux" ? ["--password-store=gnome-libsecret"] : []),
      ],
      env: launchEnv,
      timeout: 20000,
    });
    const info = await evaluate(({ app, safeStorage }, options) => {
      const builtin = process.getBuiltinModule;
      const paths = builtin("path");
      const moduleRoot = app.isPackaged ? app.getAppPath() : options.sourceRoot;
      const requireQA = builtin("module").createRequire(paths.join(moduleRoot, "package.json"));
      const filename = paths.join(moduleRoot, "electron", "ai-vault.cjs");
      const { AIVault } = requireQA(filename);
      globalThis.tablelineNativeStorageQA = new AIVault({ directory: options.directory, safeStorage, timeoutMs: options.deadline });
      return {
        platform: process.platform, arch: process.arch, electron: process.versions.electron,
        packaged: app.isPackaged,
        isolatedData: paths.resolve(app.getPath("userData")) === paths.resolve(options.directory),
        sourceSha256: builtin("crypto").createHash("sha256").update(builtin("fs").readFileSync(filename)).digest("hex"),
        methods: ["isAsyncEncryptionAvailable", "encryptStringAsync", "decryptStringAsync"].every(name => typeof safeStorage[name] === "function"),
        mockKeychain: app.commandLine.hasSwitch("use-mock-keychain"),
        chromiumNoSandbox: app.commandLine.hasSwitch("no-sandbox"),
        passwordStore: app.commandLine.getSwitchValue("password-store"),
      };
    }, { sourceRoot: root, directory, deadline: NATIVE_DEADLINE_MS });
    assert.equal(info.sourceSha256, expectedSource, "The tested vault must match the reviewed source.");
    assert.equal(info.platform, process.platform);
    assert.equal(info.arch, process.arch);
    assert.equal(info.packaged, packaged);
    assert.equal(info.isolatedData, true);
    assert.equal(info.methods, true);
    assert.equal(info.mockKeychain, false);
    assert.notEqual(info.passwordStore, "basic");
    Object.assign(report, { electron: info.electron, sourceSha256: info.sourceSha256, chromiumNoSandbox: info.chromiumNoSandbox });
  };
  const close = async () => {
    if (!application) return;
    const closing = application;
    application = undefined;
    try {
      await bounded(() => closing.close(), 5000, "Disposable Electron shutdown");
    } catch {
      await stop(closing.process());
    }
  };
  try {
    if (process.platform === "linux") daemon = await startKeyring(base);
    await check("Reviewed real Electron and AIVault start with isolated application data", launch);
    await check("OS-backed encryption is available without a plaintext backend", async () => {
      const result = await evaluate(async ({ safeStorage }) => ({
        available: await globalThis.tablelineNativeStorageQA.available(),
        backend: process.platform === "linux" ? safeStorage.getSelectedStorageBackend() : "windows_dpapi",
      }));
      report.backend = result.backend;
      report.nativeAvailable = result.available;
      assert.equal(result.available, true);
      assert.ok(result.backend && !["basic_text", "unknown"].includes(result.backend));
    });
    await check("Synthetic AI and database credentials are encrypted and roundtrip", async () => {
      for (let index = 0; index < 2; index++) {
        const id = identifiers[index];
        await evaluate(async (_electron, fixture) => {
          await globalThis.tablelineNativeStorageQA.set(fixture.id, { apiKey: fixture.marker });
        }, { id, marker: markers[index] });
        assert.equal(await evaluate(async (_electron, fixture) => {
          return (await globalThis.tablelineNativeStorageQA.get(fixture.id))?.apiKey === fixture.marker;
        }, { id, marker: markers[index] }), true);
      }
      const saved = JSON.parse(await fs.readFile(path.join(directory, "credentials.json"), "utf8"));
      assert.equal(saved.version, 1);
      assert.deepEqual(Object.keys(saved.credentials).sort(), ["ai-native-qa", "db-native-qa"]);
      for (const ciphertext of Object.values(saved.credentials)) {
        assert.equal(typeof ciphertext, "string");
        const bytes = Buffer.from(ciphertext, "base64");
        assert.ok(bytes.length > 0);
        for (const marker of markers) assert.equal(bytes.includes(Buffer.from(marker)), false);
      }
      if (process.platform !== "win32") {
        assert.equal((await fs.stat(path.join(directory, "credentials.json"))).mode & 0o777, 0o600);
      }
    });
    await check("Legacy version-1 synchronous ciphertext decrypts through the asynchronous vault", async () => {
      // Only this unlocked Linux fixture or Windows DPAPI can run this probe.
      // macOS exits before launch, so this cannot create a Keychain prompt.
      const legacyCiphertext = await evaluate(({ safeStorage }, fixture) => {
        if (!safeStorage.isEncryptionAvailable()) throw new Error("Legacy native encryption is unavailable.");
        return safeStorage.encryptString(JSON.stringify({ apiKey: fixture.marker })).toString("base64");
      }, { marker: markers[2] });
      const filename = path.join(directory, "credentials.json");
      const saved = JSON.parse(await fs.readFile(filename, "utf8"));
      saved.credentials[identifiers[2]] = legacyCiphertext;
      await fs.writeFile(filename, JSON.stringify(saved), { mode: 0o600 });
      assert.equal(await evaluate(async (_electron, fixture) => {
        return (await globalThis.tablelineNativeStorageQA.get(fixture.id))?.apiKey === fixture.marker;
      }, { id: identifiers[2], marker: markers[2] }), true);
      report.legacyFormatVersion = 1;
      report.legacySynchronousCiphertext = true;
    });
    await check("Fresh Electron process decrypts persisted ciphertext", async () => {
      await close();
      await launch();
      for (let index = 0; index < markers.length; index++) {
        assert.equal(await evaluate(async (_electron, fixture) => {
          return (await globalThis.tablelineNativeStorageQA.get(fixture.id))?.apiKey === fixture.marker;
        }, { id: identifiers[index], marker: markers[index] }), true);
      }
    });
    await check("Corrupt ciphertext is rejected with a redacted error", async () => {
      const filename = path.join(directory, "credentials.json");
      const saved = JSON.parse(await fs.readFile(filename, "utf8"));
      saved.credentials["ai-native-qa"] = Buffer.alloc(48, 0xff).toString("base64");
      await fs.writeFile(filename, JSON.stringify(saved), { mode: 0o600 });
      const result = await evaluate(async () => {
        try {
          await globalThis.tablelineNativeStorageQA.get("ai-native-qa");
          return { rejected: false };
        } catch (error) {
          return { rejected: true, message: error.message, code: error.code || null };
        }
      });
      assert.equal(result.rejected, true);
      assert.ok(result.message.trim());
      for (const marker of markers) assert.equal(result.message.includes(marker), false);
      assert.equal(await evaluate(async (_electron, fixture) => {
        return (await globalThis.tablelineNativeStorageQA.get("db-native-qa"))?.apiKey === fixture.marker;
      }, { marker: markers[1] }), true);
    });
    await check("Removing a credential preserves the independent database credential", async () => {
      await evaluate(async () => { await globalThis.tablelineNativeStorageQA.delete("ai-native-qa"); });
      assert.equal(await evaluate(async () => globalThis.tablelineNativeStorageQA.has("ai-native-qa")), false);
      assert.equal(await evaluate(async (_electron, fixture) => {
        return (await globalThis.tablelineNativeStorageQA.get("db-native-qa"))?.apiKey === fixture.marker;
      }, { marker: markers[1] }), true);
    });
    await close();
    await check("Application and disposable keyring files contain no plaintext credential", async () => {
      report.scannedFiles = await scanFiles(base, markers);
      assert.ok(report.scannedFiles > 0);
    });
    report.status = "passed";
    report.nativeCredentialAcceptance = true;
  } catch {
    report.status = "failed";
    process.exitCode = 1;
    console.error("Native secure-storage acceptance failed. No credential values or raw native errors are reported.");
  } finally {
    await close();
    await stop(daemon);
    await fs.mkdir(path.dirname(reportFile), { recursive: true });
    await fs.writeFile(reportFile, JSON.stringify(report, null, 2) + "\n");
    if (ownsBase) await fs.rm(base, { recursive: true, force: true });
    console.log(JSON.stringify({ status: report.status, platform: report.platform, arch: report.arch, backend: report.backend || "unavailable", passed: checks.filter(check => check.status === "passed").length, failed: checks.filter(check => check.status === "failed").length }));
  }
}

async function main() {
  if (!["linux", "win32"].includes(process.platform))
    throw new Error("Native credential acceptance excludes macOS; signed Keychain acceptance requires a separate supervised run.");
  if (!["x64", "arm64"].includes(process.arch)) throw new Error("Unsupported native acceptance architecture.");
  let linuxSession = false, sourceRoot;
  for (const argument of process.argv.slice(2)) {
    if (argument === "--linux-session" && !linuxSession) linuxSession = true;
    else if (argument.startsWith("--source-root=") && sourceRoot === undefined) sourceRoot = argument.slice("--source-root=".length);
    else throw new Error("Usage: node scripts/e2e-storage.cjs [--source-root=/absolute/project/path]");
  }
  if (sourceRoot !== undefined) {
    if (!path.isAbsolute(sourceRoot)) throw new Error("Source root must be an absolute project path.");
    root = path.resolve(sourceRoot);
  }
  if (process.platform === "linux") {
    if (!linuxSession) return isolatedLinux();
    if (process.env.TABLELINE_STORAGE_DBUS_SESSION !== "1" || !process.env.DBUS_SESSION_BUS_ADDRESS)
      throw new Error("Linux credential acceptance requires the script's disposable D-Bus session.");
  } else if (linuxSession) throw new Error("The Linux session option cannot be used on Windows.");
  return acceptance();
}

if (require.main === module) main().catch(() => {
  console.error("Native credential acceptance could not complete. macOS is excluded; Linux requires dbus-run-session, dbus-send and gnome-keyring-daemon.");
  process.exitCode = 1;
});

module.exports = { main, bounded, scanFiles, NATIVE_DEADLINE_MS };
