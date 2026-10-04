/* Copyright (C) 2026 Davide Leopardi
 * SPDX-License-Identifier: GPL-3.0-only */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { saveSettings } = require("../electron/settings.cjs");

function fixture(t) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "branchline-settings-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "store.json");
  const store = {
    settings: { language: "it", theme: "dark", fontSize: 13, autoStash: true },
    repos: [{ path: "/fixture/repository" }],
  };
  const allowedKeys = Object.keys(store.settings);
  const persist = () => fs.writeFileSync(filename, JSON.stringify(store));
  persist();
  return {
    store,
    allowedKeys,
    persist,
    disk: () => JSON.parse(fs.readFileSync(filename, "utf8")),
  };
}

test("failed settings write restores the previous object and cannot leak into a later save", (t) => {
  const { store, allowedKeys, persist, disk } = fixture(t);
  const previous = store.settings;
  const writeError = Object.assign(
    new Error("Injected settings write failure"),
    {
      code: "ENOSPC",
    },
  );
  assert.throws(
    () =>
      saveSettings(
        store,
        { language: "ja", fontSize: 18, autoStash: false },
        allowedKeys,
        () => {
          assert.equal(store.settings.language, "ja");
          assert.notStrictEqual(store.settings, previous);
          throw writeError;
        },
      ),
    (error) => error === writeError,
  );
  assert.strictEqual(store.settings, previous);
  assert.deepEqual(store.settings, {
    language: "it",
    theme: "dark",
    fontSize: 13,
    autoStash: true,
  });
  assert.deepEqual(disk(), store);

  saveSettings(store, { theme: "light" }, allowedKeys, persist);
  assert.deepEqual(disk().settings, {
    language: "it",
    theme: "light",
    fontSize: 13,
    autoStash: true,
  });
});

test("successful partial settings save preserves untouched preferences and other store data", (t) => {
  const { store, allowedKeys, persist, disk } = fixture(t);
  const previous = store.settings;
  const saved = saveSettings(
    store,
    { language: "de", theme: undefined, ignored: "discard this field" },
    allowedKeys,
    persist,
  );
  assert.strictEqual(saved, store.settings);
  assert.notStrictEqual(saved, previous);
  assert.equal(previous.language, "it");
  assert.deepEqual(saved, {
    language: "de",
    theme: "dark",
    fontSize: 13,
    autoStash: true,
  });
  assert.deepEqual(disk(), {
    settings: saved,
    repos: [{ path: "/fixture/repository" }],
  });
});
