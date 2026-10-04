/* Copyright (C) 2026 Davide Leopardi
 * SPDX-License-Identifier: GPL-3.0-only */

const path = require("node:path");
const fix = require("./fix-pty.cjs");
module.exports = async (context) =>
  fix(path.join(context.packager.info.appDir, "node_modules/node-pty"));
