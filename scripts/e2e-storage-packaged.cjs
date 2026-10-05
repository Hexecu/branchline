/* Copyright (C) 2026 Davide Leopardi
 * SPDX-License-Identifier: GPL-3.0-only */

"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { layout, verifyDesktop } = require("./verify-desktop.cjs");
const { main } = require("./e2e-storage.cjs");

async function run() {
  if (!process.env.BRANCHLINE_PACKAGE_OUTPUT)
    throw new Error(
      "Set BRANCHLINE_PACKAGE_OUTPUT to the freshly built package directory.",
    );
  const report = JSON.parse(
    fs.readFileSync(
      path.join(
        process.env.BRANCHLINE_PACKAGE_OUTPUT,
        "desktop-verification.json",
      ),
      "utf8",
    ),
  );
  verifyDesktop(report.bundle, { probeNative: true, verifySource: true });
  process.env.BRANCHLINE_E2E_EXECUTABLE = layout(report.bundle).executable;
  await main();
}
run().catch(() => {
  console.error("Packaged native credential acceptance could not complete.");
  process.exitCode = 1;
});
