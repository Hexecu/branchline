/* Copyright (C) 2026 Davide Leopardi
 * SPDX-License-Identifier: GPL-3.0-only */

const { spawn } = require("node:child_process");
const path = require("node:path");
const root = path.join(__dirname, "..");
const vite = spawn(
  process.execPath,
  [path.join(root, "node_modules/vite/bin/vite.js")],
  { cwd: root, stdio: "inherit" },
);
let electron;
async function start() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch("http://127.0.0.1:5176");
      if (res.ok) {
        electron = spawn(require("electron"), ["."], {
          cwd: root,
          env: { ...process.env, BRANCHLINE_DEV_URL: "http://127.0.0.1:5176" },
          stdio: "inherit",
        });
        electron.on("exit", () => {
          vite.kill();
          process.exit();
        });
        return;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  vite.kill();
  console.error("Vite non ha risposto");
  process.exit(1);
}
function stop() {
  electron?.kill();
  vite.kill();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
start();
