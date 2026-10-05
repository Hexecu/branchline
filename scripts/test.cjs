/* Copyright (C) 2026 Davide Leopardi
 * SPDX-License-Identifier: GPL-3.0-only */

"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const files = fs
  .readdirSync(path.join(root, "tests"))
  .filter((name) => name.endsWith(".test.cjs"))
  .sort();
const result = spawnSync(
  process.execPath,
  ["--test", ...files.map((name) => path.join(root, "tests", name))],
  { cwd: root, stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
