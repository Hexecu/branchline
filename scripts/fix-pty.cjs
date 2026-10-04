/* Copyright (C) 2026 Davide Leopardi
 * SPDX-License-Identifier: GPL-3.0-only */

const fs = require("node:fs");
const path = require("node:path");
function fix(dir) {
  if (!fs.existsSync(dir)) return;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) fix(file);
    else if (item.name === "spawn-helper") fs.chmodSync(file, 0o755);
  }
}
fix(path.join(__dirname, "../node_modules/node-pty"));
module.exports = fix;
