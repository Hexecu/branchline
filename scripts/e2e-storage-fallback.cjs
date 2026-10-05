// Copyright (c) 2026 Davide Leopardi
// SPDX-License-Identifier: GPL-3.0-only

"use strict";

// Negative acceptance for real Electron Linux encryption. The private D-Bus
// configuration has no activatable services, so no keyring or portal can prompt.
// Electron still reports the configured GNOME backend and async availability;
// its fixed-key v10 fallback must never be accepted by the application vault.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createHash, randomBytes, createDecipheriv } = require("node:crypto");
const { createRequire } = require("node:module");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { bounded, scanFiles, NATIVE_DEADLINE_MS } = require("./e2e-storage.cjs");
const command = promisify(execFile);
let root = path.resolve(__dirname, "..");

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  try {
    await bounded(() => new Promise(resolve => child.once("exit", resolve)), 2000, "Owned process shutdown");
  } catch {
    child.kill("SIGKILL");
  }
}

async function isolatedSession() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "tableline-storage-fallback-"));
  let child;
  try {
    const environment = { ...process.env, TABLELINE_STORAGE_FALLBACK_ROOT: base, XDG_CURRENT_DESKTOP: "GNOME" };
    for (const [name, directory] of Object.entries({ XDG_CONFIG_HOME: "config", XDG_DATA_HOME: "data", XDG_CACHE_HOME: "cache", XDG_RUNTIME_DIR: "runtime" })) {
      environment[name] = path.join(base, directory);
      await fs.mkdir(environment[name], { mode: 0o700 });
    }
    for (const name of ["DBUS_SESSION_BUS_ADDRESS", "DBUS_SESSION_BUS_PID", "GNOME_KEYRING_CONTROL", "GNOME_KEYRING_PID", "SSH_AUTH_SOCK"])
      delete environment[name];
    const config = path.join(base, "dbus-no-services.conf");
    await fs.writeFile(config, `<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-BUS Bus Configuration 1.0//EN" "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig><type>session</type><listen>unix:tmpdir=/tmp</listen><policy context="default"><allow send_destination="*"/><allow own="*"/><allow eavesdrop="true"/></policy></busconfig>
`, { mode: 0o600 });
    child = spawn("dbus-run-session", [`--config-file=${config}`, "--", process.execPath, __filename, `--source-root=${root}`, "--linux-session"], {
      env: environment, stdio: ["ignore", "inherit", "inherit"],
    });
    const outcome = await bounded(() => new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    }), 60000, "Private fallback acceptance session");
    if (outcome.code !== 0 || outcome.signal) throw new Error("Private fallback acceptance failed.");
  } finally {
    await stop(child);
    await fs.rm(base, { recursive: true, force: true });
  }
}

async function acceptance() {
  const sourceRequire = createRequire(path.join(root, "package.json"));
  const name = sourceRequire("./package.json").name;
  if (!["tableline", "branchline"].includes(name)) throw new Error("Unsupported acceptance application.");
  let executablePath = process.env[`${name.toUpperCase()}_E2E_EXECUTABLE`];
  if (name === "branchline" && !executablePath && process.env.BRANCHLINE_PACKAGE_OUTPUT) {
    const verification = JSON.parse(await fs.readFile(path.join(process.env.BRANCHLINE_PACKAGE_OUTPUT, "desktop-verification.json"), "utf8"));
    const { layout, verifyDesktop } = sourceRequire("./scripts/verify-desktop.cjs");
    verifyDesktop(verification.bundle, { probeNative: true, verifySource: true });
    executablePath = layout(verification.bundle).executable;
  }
  const packaged = Boolean(executablePath);
  const reportFile = path.resolve(process.env.TABLELINE_STORAGE_FALLBACK_REPORT || path.join(root, "artifacts", "e2e", "storage-fallback", `${packaged ? "packaged" : "source"}-linux-${process.arch}`, "report.json"));
  const base = process.env.TABLELINE_STORAGE_FALLBACK_ROOT;
  if (!base || !path.isAbsolute(base) || !/^tableline-storage-fallback-[A-Za-z0-9]+$/.test(path.basename(base)))
    throw new Error("A private disposable acceptance directory is required.");
  const directory = path.join(base, "app-data");
  await fs.mkdir(directory, { mode: 0o700 });
  const marker = "synthetic-native-fallback-" + randomBytes(24).toString("hex");
  const expectedSource = createHash("sha256").update(await fs.readFile(path.join(root, "electron", "ai-vault.cjs"))).digest("hex");
  const checks = [];
  const report = { application: name, platform: process.platform, arch: process.arch, packaged, nativeDeadlineMs: NATIVE_DEADLINE_MS,
    syntheticCredentialsOnly: true, rendererSandboxAcceptance: false, nativeFallbackRejectionAcceptance: false, checks };
  let application, legacyCiphertext;
  const check = async (label, work) => {
    const started = performance.now();
    try {
      await work();
      checks.push({ name: label, status: "passed", durationMs: Math.round(performance.now() - started) });
      console.log("PASS", label);
    } catch {
      checks.push({ name: label, status: "failed", error: "Fallback acceptance assertion failed; synthetic credential diagnostics are withheld." });
      throw new Error("Fallback acceptance failed.");
    }
  };
  const evaluate = (work, value) => bounded(() => application.evaluate(work, value), NATIVE_DEADLINE_MS + 2000, "Native fallback operation");
  const launch = async () => {
    const { _electron } = sourceRequire("playwright");
    application = await _electron.launch({
      executablePath: executablePath || sourceRequire("electron"),
      args: [...(packaged ? [] : [path.join(root, "electron", "main.cjs")]), `--${name}-qa`, `--${name}-data=${directory}`, "--password-store=gnome-libsecret"],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "", TABLELINE_DEV_URL: "", BRANCHLINE_DEV_URL: "", ...(name === "branchline" ? { BRANCHLINE_DATA_DIR: directory } : {}) },
      timeout: 20000,
    });
    const info = await evaluate(({ app, safeStorage }, options) => {
      const builtin = process.getBuiltinModule, paths = builtin("path");
      const moduleRoot = app.isPackaged ? app.getAppPath() : options.root;
      const filename = paths.join(moduleRoot, "electron", "ai-vault.cjs");
      const appRequire = builtin("module").createRequire(paths.join(moduleRoot, "package.json"));
      const { AIVault } = appRequire(filename);
      const decrypt = safeStorage.decryptStringAsync.bind(safeStorage);
      globalThis.nativeFallbackDecryptCalls = 0;
      safeStorage.decryptStringAsync = (...args) => {
        globalThis.nativeFallbackDecryptCalls++;
        return decrypt(...args);
      };
      globalThis.nativeFallbackQA = new AIVault({ directory: options.directory, safeStorage, timeoutMs: options.deadline });
      return { platform: process.platform, arch: process.arch, electron: process.versions.electron, packaged: app.isPackaged,
        isolatedData: paths.resolve(app.getPath("userData")) === paths.resolve(options.directory),
        sourceSha256: builtin("crypto").createHash("sha256").update(builtin("fs").readFileSync(filename)).digest("hex"),
        mockKeychain: app.commandLine.hasSwitch("use-mock-keychain"), chromiumNoSandbox: app.commandLine.hasSwitch("no-sandbox"),
        backend: safeStorage.getSelectedStorageBackend() };
    }, { root, directory, deadline: NATIVE_DEADLINE_MS });
    assert.equal(info.platform, "linux");
    assert.equal(info.arch, process.arch);
    assert.equal(info.packaged, packaged);
    assert.equal(info.isolatedData, true);
    assert.equal(info.sourceSha256, expectedSource);
    assert.equal(info.mockKeychain, false);
    assert.equal(info.backend, "gnome_libsecret");
    Object.assign(report, { electron: info.electron, sourceSha256: info.sourceSha256, configuredBackend: info.backend, chromiumNoSandbox: info.chromiumNoSandbox });
  };
  const close = async () => {
    if (!application) return;
    const closing = application;
    application = undefined;
    try { await bounded(() => closing.close(), 5000, "Disposable Electron shutdown"); }
    catch { await stop(closing.process()); }
  };
  try {
    await check("Private D-Bus session has no active or activatable keyring or portal", async () => {
      for (const method of ["ListNames", "ListActivatableNames"]) {
        const { stdout } = await command("dbus-send", ["--session", "--type=method_call", "--print-reply", "--dest=org.freedesktop.DBus", "/org/freedesktop/DBus", `org.freedesktop.DBus.${method}`], { timeout: 1000, maxBuffer: 8192 });
        assert.doesNotMatch(stdout, /org\.freedesktop\.(?:secrets|portal)|org\.kde\.kwallet/);
      }
      report.secureProviderServiceAbsent = true;
    });
    await check("Exact real Electron and reviewed vault start in isolated application data", launch);
    await check("Configured GNOME still produces publicly recoverable native v10 fallback", async () => {
      const result = await evaluate(async ({ safeStorage }, fixture) => ({ available: await safeStorage.isAsyncEncryptionAvailable(),
        ciphertext: (await safeStorage.encryptStringAsync(JSON.stringify({ apiKey: fixture.marker }))).toString("base64") }), { marker });
      assert.equal(result.available, true);
      const bytes = Buffer.from(result.ciphertext, "base64");
      assert.equal(bytes.subarray(0, 3).toString(), "v10");
      // Exact Chromium 152 PosixKeyProvider constant and AES-CBC fixed IV.
      const key = Buffer.from("fd621fe5a2b402539dfa147ca9272778", "hex");
      const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
      const recovered = Buffer.concat([decipher.update(bytes.subarray(3)), decipher.final()]).toString();
      assert.equal(JSON.parse(recovered).apiKey, marker);
      legacyCiphertext = result.ciphertext;
      Object.assign(report, { rawAsyncAvailable: true, rawCiphertextPrefix: "v10", rawFallbackPublicKeyRecovery: true });
    });
    await check("Vault rejects fallback encryption and leaves credentials absent", async () => {
      const result = await evaluate(async (_electron, fixture) => {
        try { await globalThis.nativeFallbackQA.set("ai-native-fallback", { apiKey: fixture.marker }); return { rejected: false }; }
        catch (error) { return { rejected: true, message: error.message, code: error.code, status: globalThis.nativeFallbackQA.status() }; }
      }, { marker });
      assert.equal(result.rejected, true);
      assert.equal(result.message.includes(marker), false);
      assert.equal(result.code, "SECURE_STORAGE_INSECURE");
      assert.equal(result.status, "unavailable");
      await assert.rejects(fs.stat(path.join(directory, "credentials.json")), error => error.code === "ENOENT");
      report.newCredentialRejected = true;
    });
    await close();
    const filename = path.join(directory, "credentials.json");
    const oldBytes = Buffer.from(JSON.stringify({ version: 1, credentials: { "ai-native-fallback": legacyCiphertext } }));
    await fs.writeFile(filename, oldBytes, { mode: 0o600 });
    await check("Fresh vault refuses existing weak v10 without returning credentials or changing disk", async () => {
      await launch();
      const result = await evaluate(async () => {
        try { await globalThis.nativeFallbackQA.get("ai-native-fallback"); return { rejected: false }; }
        catch (error) { return { rejected: true, message: error.message, code: error.code, decryptCalls: globalThis.nativeFallbackDecryptCalls }; }
      });
      assert.equal(result.rejected, true);
      assert.equal(result.message.includes(marker), false);
      assert.equal(result.code, "SECURE_STORAGE_INSECURE");
      assert.equal(result.decryptCalls, 0);
      assert.deepEqual(await fs.readFile(filename), oldBytes);
      report.existingWeakCredentialRejected = true;
    });
    await check("Rejected save preserves the existing credential file byte for byte", async () => {
      const rejected = await evaluate(async (_electron, fixture) => {
        try { await globalThis.nativeFallbackQA.set("ai-new-fallback", { apiKey: fixture.marker }); return false; }
        catch { return true; }
      }, { marker });
      assert.equal(rejected, true);
      assert.deepEqual(await fs.readFile(filename), oldBytes);
    });
    await close();
    await check("Disposable fallback fixture contains no plaintext credential", async () => {
      report.scannedFiles = await scanFiles(base, [marker]);
      assert.ok(report.scannedFiles > 0);
    });
    report.status = "passed";
    report.nativeFallbackRejectionAcceptance = true;
  } catch {
    report.status = "failed";
    process.exitCode = 1;
    console.error("Native fallback acceptance failed. No credential values or raw native errors are reported.");
  } finally {
    await close();
    await fs.mkdir(path.dirname(reportFile), { recursive: true });
    await fs.writeFile(reportFile, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify({ status: report.status, application: name, platform: process.platform, arch: process.arch,
      passed: checks.filter(item => item.status === "passed").length, failed: checks.filter(item => item.status === "failed").length }));
  }
}

async function main() {
  if (process.platform !== "linux") throw new Error("Native fallback acceptance is Linux-only and never uses the host macOS Keychain.");
  if (!["x64", "arm64"].includes(process.arch)) throw new Error("Unsupported Linux architecture.");
  let session = false;
  for (const argument of process.argv.slice(2)) {
    if (argument === "--linux-session" && !session) session = true;
    else if (argument.startsWith("--source-root=")) {
      const selected = argument.slice("--source-root=".length);
      if (!path.isAbsolute(selected)) throw new Error("Source root must be absolute.");
      root = path.resolve(selected);
    } else throw new Error("Usage: node scripts/e2e-storage-fallback.cjs [--source-root=/absolute/project/path]");
  }
  if (!session) return isolatedSession();
  if (!process.env.DBUS_SESSION_BUS_ADDRESS) throw new Error("A disposable private D-Bus session is required.");
  return acceptance();
}

if (require.main === module) main().catch(() => {
  console.error("Native fallback acceptance could not complete. It requires Linux, dbus-run-session and dbus-send.");
  process.exitCode = 1;
});

module.exports = { main };
