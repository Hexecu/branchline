/* Copyright (C) 2026 Davide Leopardi
 * SPDX-License-Identifier: GPL-3.0-only */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { verifyProjectLicense } = require("../scripts/verify-package.cjs");
const packageData = require("../package.json");
const root = path.resolve(__dirname, "..");
const readFile = (name) => fs.readFileSync(path.join(root, name));

test("future packages include GPLv3, copyright and separate dependency notices", () => {
  assert.equal(verifyProjectLicense(packageData, readFile), true);
  assert.equal(
    require("../package-lock.json").packages[""].license,
    "GPL-3.0-only",
  );
  for (const notice of ["LICENSE", "COPYRIGHT", "THIRD_PARTY_NOTICES.md"])
    assert.ok(packageData.build.files.includes(notice), notice);
});

test("the current release gate rejects stale MIT metadata and incomplete GPL grants", () => {
  assert.throws(
    () => verifyProjectLicense({ ...packageData, license: "MIT" }, readFile),
    /declare GPL-3.0-only/,
  );
  for (const replacement of [
    Buffer.from("GPL-3.0-only"),
    readFile("LICENSE").subarray(0, 1000),
  ])
    assert.throws(
      () =>
        verifyProjectLicense(packageData, (name) =>
          name === "LICENSE" ? replacement : readFile(name),
        ),
      /complete, verbatim GPLv3/,
    );
});

test("the release gate rejects absent copyright, source access and dependency notices", () => {
  for (const name of ["COPYRIGHT", "THIRD_PARTY_NOTICES.md"])
    assert.throws(
      () =>
        verifyProjectLicense(packageData, (entry) =>
          entry === name ? Buffer.alloc(0) : readFile(entry),
        ),
      /missing.*notice/,
    );
  assert.throws(
    () =>
      verifyProjectLicense(packageData, (entry) =>
        entry === "COPYRIGHT"
          ? Buffer.from(
              readFile(entry)
                .toString("utf8")
                .replaceAll(
                  "https://github.com/Hexecu/branchline/releases",
                  "",
                ),
            )
          : readFile(entry),
      ),
    /copyright and source notice/,
  );
});
