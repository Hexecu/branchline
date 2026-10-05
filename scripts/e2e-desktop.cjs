/* Copyright (C) 2026 Davide Leopardi
 * SPDX-License-Identifier: GPL-3.0-only */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { _electron } = require("playwright");
const { layout, verifyDesktop } = require("./verify-desktop.cjs");
const root = path.resolve(__dirname, "..");
const execute = promisify(execFile);

async function main() {
  const packageOutput = process.env.BRANCHLINE_PACKAGE_OUTPUT;
  if (!packageOutput)
    throw new Error(
      "Set BRANCHLINE_PACKAGE_OUTPUT to the freshly built native package directory.",
    );
  const verification = JSON.parse(
    await fs.readFile(
      path.join(packageOutput, "desktop-verification.json"),
      "utf8",
    ),
  );
  verifyDesktop(verification.bundle, { probeNative: true, verifySource: true });
  const temporary = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "branchline-desktop-")),
  );
  const dataDir = path.join(temporary, "userdata"),
    repo = path.join(temporary, "fixture");
  const checks = [],
    errors = [];
  let sandbox;
  let desktop;
  const check = (name, condition) => {
    assert.ok(condition, name);
    checks.push({ name, status: "passed" });
  };
  try {
    await fs.mkdir(repo);
    const env = {
      ...process.env,
      GIT_CONFIG_GLOBAL: os.devNull,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    };
    const git = async (...args) =>
      (await execute("git", ["-C", repo, ...args], { env })).stdout.trim();
    await git("init", "-b", "main");
    await git("config", "core.autocrlf", "false");
    await git("config", "user.name", "Desktop Fixture");
    await git("config", "user.email", "desktop@example.invalid");
    await git("config", "commit.gpgsign", "false");
    await git("config", "core.hooksPath", path.join(temporary, "no-hooks"));
    await fs.writeFile(path.join(repo, "notes.txt"), "fixture baseline\n");
    await git("add", ".");
    await git("commit", "-m", "Desktop baseline");
    const launchEnv = { ...env, BRANCHLINE_DATA_DIR: dataDir };
    delete launchEnv.ELECTRON_RUN_AS_NODE;
    desktop = await _electron.launch({
      executablePath: layout(verification.bundle).executable,
      chromiumSandbox: true,
      args: [],
      env: launchEnv,
      timeout: 60000,
    });
    const page = await desktop.firstWindow({ timeout: 60000 });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.waitForFunction(() => Boolean(window.branchline), undefined, {
      timeout: 30000,
    });
    const invoke = (method, payload = {}) =>
      page.evaluate(
        ({ method, payload }) => window.branchline.invoke(method, payload),
        { method, payload },
      );
    const initial = await invoke("app.bootstrap");
    check(
      "isolated packaged startup and preload IPC",
      initial.repos.length === 0 && initial.version === verification.version,
    );
    check(
      "packaged renderer visible",
      (await page.locator(".brand strong").innerText()) === "Branchline",
    );
    const opened = await invoke("repo.open", { path: repo });
    check(
      "Git repository read through renderer IPC",
      opened.branch === "main" &&
        opened.commits.some((commit) => commit.subject === "Desktop baseline"),
    );
    await page.reload();
    await page
      .getByText("Desktop baseline", { exact: true })
      .first()
      .waitFor({ timeout: 30000 });
    check("commit graph rendered", true);
    await fs.writeFile(path.join(repo, "notes.txt"), "fixture changed\n");
    const diff = await invoke("repo.diff", { path: repo, file: "notes.txt" });
    check("real working tree diff", diff.includes("+fixture changed"));
    await invoke("repo.action", {
      path: repo,
      operation: "stage",
      files: ["notes.txt"],
    });
    const staged = await invoke("repo.snapshot", { path: repo });
    check(
      "staging through renderer IPC",
      staged.files.some((file) => file.path === "notes.txt" && file.staged),
    );
    await invoke("repo.action", {
      path: repo,
      operation: "commit",
      message: "Desktop verified",
    });
    check(
      "isolated commit execution",
      (await git("log", "-1", "--format=%s")) === "Desktop verified",
    );
    await page.evaluate(() => {
      window.__desktopTerminal = { output: "", exited: false, exitCode: null };
      window.branchline.on("terminal.data", ({ data }) => {
        window.__desktopTerminal.output += data;
      });
      window.branchline.on("terminal.exit", ({ code }) => {
        window.__desktopTerminal.exited = true;
        window.__desktopTerminal.exitCode = code;
      });
    });
    const terminal = await invoke("terminal.open", { path: repo });
    await invoke("terminal.resize", { id: terminal.id, cols: 92, rows: 22 });
    await invoke("terminal.write", {
      id: terminal.id,
      data:
        process.platform === "win32"
          ? "echo branchline-ui-^o^k\r"
          : "printf 'branchline-ui-%s\\n' 'ok'\r",
    });
    await page.waitForFunction(
      () => window.__desktopTerminal.output.includes("branchline-ui-ok"),
      undefined,
      { timeout: 20000 },
    );
    await invoke("terminal.write", { id: terminal.id, data: "exit\r" });
    await page.waitForFunction(
      () => window.__desktopTerminal.exited,
      undefined,
      { timeout: 20000 },
    );
    check(
      "native terminal spawn, write, resize and exit through IPC",
      await page.evaluate(() => window.__desktopTerminal.exitCode === 0),
    );
    const modifiers = await page
      .locator(".command-button kbd")
      .allTextContents();
    check(
      "platform keyboard hints",
      modifiers.length > 0 &&
        modifiers.every((label) =>
          process.platform === "darwin"
            ? label.includes("⌘")
            : label.includes("Ctrl+"),
        ),
    );
    check("renderer has no uncaught errors", errors.length === 0);
    const runtime = await desktop.evaluate(() => ({
      platform: process.platform,
      arch: process.arch,
    }));
    sandbox = await desktop.evaluate(async ({ app, BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      const preferences = contents.getLastWebPreferences();
      const pid = contents.getOSProcessId();
      const metric = app.getAppMetrics().find((entry) => entry.pid === pid);
      const readStatus = (id) =>
        process
          .getBuiltinModule("fs")
          .readFileSync(`/proc/${id}/status`, "utf8");
      const nativeStatus = process.platform === "linux" ? readStatus(pid) : "";
      const namespaceDepth = (status) =>
        status
          .match(/^NSpid:\s+(.+)$/m)?.[1]
          .trim()
          .split(/\s+/).length || 0;
      const linuxNamespace =
        process.platform === "linux"
          ? {
              main: namespaceDepth(readStatus(process.pid)),
              renderer: namespaceDepth(nativeStatus),
            }
          : null;
      const osSandboxed =
        process.platform === "linux"
          ? /^NoNewPrivs:\s+1$/m.test(nativeStatus) &&
            /^Seccomp:\s+2$/m.test(nativeStatus) &&
            linuxNamespace.renderer > linuxNamespace.main
          : metric?.sandboxed === true;
      return {
        chromiumNoSandbox: app.commandLine.hasSwitch("no-sandbox"),
        sandboxConfigured: preferences.sandbox === true,
        contextIsolation: preferences.contextIsolation === true,
        nodeIntegration: preferences.nodeIntegration === true,
        osSandboxed,
        linuxNamespace,
      };
    });
    const renderer = await page.evaluate(() => ({
      hasRequire: typeof require !== "undefined",
      hasProcess: typeof process !== "undefined",
    }));
    check(
      "renderer sandbox and context isolation remain enabled",
      !sandbox.chromiumNoSandbox &&
        sandbox.sandboxConfigured &&
        sandbox.contextIsolation &&
        !sandbox.nodeIntegration &&
        sandbox.osSandboxed &&
        !renderer.hasRequire &&
        !renderer.hasProcess,
    );
    sandbox.rendererSandboxAcceptance = true;
    check(
      "native Electron architecture matches the runner",
      runtime.platform === process.platform && runtime.arch === process.arch,
    );
    await desktop.close();
    desktop = null;
    check("application closes cleanly", true);
  } finally {
    if (desktop) await desktop.close().catch(() => {});
    await fs.mkdir(path.join(root, "artifacts", "desktop"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(root, "artifacts", "desktop", "report.json"),
      JSON.stringify(
        {
          platform: process.platform,
          arch: process.arch,
          version: verification.version,
          credentials:
            "No credential imports or native encryption/decryption calls",
          sandbox,
          checks,
          errors,
        },
        null,
        2,
      ) + "\n",
    );
    await fs.rm(temporary, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 250,
    });
  }
  console.log(
    `${checks.length} packaged desktop checks passed (${process.platform}/${process.arch}).`,
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
