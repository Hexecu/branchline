/* Copyright (C) 2026 Davide Leopardi
 * SPDX-License-Identifier: GPL-3.0-only */

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { AIVault } = require("../electron/ai-vault.cjs");
const { AIService } = require("../electron/ai.cjs");
const { ProviderService } = require("../electron/providers.cjs");

// Synthetic encryption only. The native Linux/Windows harness covers real OS
// backends; these tests exercise the actual on-disk vault/profile transaction.
const LEGACY = Buffer.from("v10unsafe-fixture-only").toString("base64");
const REPLACEMENT = "synthetic-safe-replacement";
const ID = "recoverable";

async function fixture(t, kind) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "branchline-recovery-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const calls = { encrypt: 0, decrypt: 0 };
  const safeStorage = {
    getSelectedStorageBackend: () => "gnome_libsecret",
    isAsyncEncryptionAvailable: async () => true,
    async encryptStringAsync(value) {
      calls.encrypt++;
      const bytes = Buffer.from(value);
      for (let i = 0; i < bytes.length; i++) bytes[i] ^= 0xb9;
      return Buffer.concat([Buffer.from("v11"), bytes]);
    },
    async decryptStringAsync(value) {
      calls.decrypt++;
      assert.equal(value.subarray(0, 3).toString(), "v11");
      const bytes = Buffer.from(value.subarray(3));
      for (let i = 0; i < bytes.length; i++) bytes[i] ^= 0xb9;
      return { result: bytes.toString(), shouldReEncrypt: false };
    },
  };
  const vault = new AIVault({
    directory: path.join(directory, "vault"),
    safeStorage,
    platform: "linux",
  });
  const file = path.join(directory, "profiles.json");
  const service =
    kind === "AI"
      ? new AIService({ file, vault })
      : new ProviderService({ file, vault });
  await service.settings();
  await service.save(
    kind === "AI"
      ? { id: ID, provider: "litellm", baseUrl: "https://gateway.example" }
      : { id: ID, name: "Recovery", provider: "github" },
  );
  // Model a pre-existing v1 file; rollback receipts are exclusively obtained
  // from a successful transaction and are never invented by the fixture.
  await fs.mkdir(vault.directory, { recursive: true, mode: 0o700 });
  await fs.writeFile(
    vault.file,
    JSON.stringify({ version: 1, credentials: { [ID]: LEGACY } }),
    { mode: 0o600 },
  );
  const remove = () =>
    kind === "AI" ? service.remove(ID) : service.delete(ID);
  return { service, vault, file, calls, remove };
}

for (const kind of ["AI", "hosting"]) {
  test(`${kind} imports a safe credential over v10 without decrypting or merging the unsafe entry`, async (t) => {
    const f = await fixture(t, kind);
    await f.service.save({ id: ID }, { apiKey: REPLACEMENT });
    assert.equal(f.calls.decrypt, 0);
    assert.equal(f.calls.encrypt, 1);
    assert.notEqual(await f.vault.snapshot(ID), LEGACY);
    assert.deepEqual(await f.vault.get(ID), { apiKey: REPLACEMENT });
    assert(!(await fs.readFile(f.file, "utf8")).includes(REPLACEMENT));
    assert(!(await fs.readFile(f.vault.file, "utf8")).includes(REPLACEMENT));
  });

  for (const operation of ["clear", "delete"]) {
    test(`${kind} explicitly ${operation}s v10 without any native decrypt or encrypt`, async (t) => {
      const f = await fixture(t, kind);
      if (operation === "clear") await f.service.save({ id: ID }, {});
      else await f.remove();
      assert.equal(await f.vault.snapshot(ID), null);
      assert.deepEqual(f.calls, { encrypt: 0, decrypt: 0 });
      const profile = (await f.service.settings()).profiles.find(
        (row) => row.id === ID,
      );
      if (operation === "clear") assert.equal(profile.hasCredential, false);
      else assert.equal(profile, undefined);
    });
  }

  for (const operation of ["replace", "clear", "delete"]) {
    test(`${kind} failed ${operation} metadata persistence restores byte-identical v10 without native decryption`, async (t) => {
      const f = await fixture(t, kind),
        before = await fs.readFile(f.file, "utf8");
      f.service.persist = async () => {
        throw new Error("Synthetic metadata write failure");
      };
      await assert.rejects(
        operation === "delete"
          ? f.remove()
          : f.service.save(
              { id: ID, name: "Changed" },
              operation === "replace" ? { apiKey: REPLACEMENT } : {},
            ),
        /Synthetic metadata write failure/,
      );
      assert.equal(await f.vault.snapshot(ID), LEGACY);
      assert.equal(await fs.readFile(f.file, "utf8"), before);
      assert.equal(f.calls.decrypt, 0);
      assert.equal(f.calls.encrypt, operation === "replace" ? 1 : 0);
      assert(
        (await f.service.settings()).profiles.some((row) => row.id === ID),
      );
    });
  }

  test(`${kind} rollback preserves a concurrent safe replacement instead of restoring old ciphertext`, async (t) => {
    const f = await fixture(t, kind);
    f.service.persist = async () => {
      await f.vault.set(ID, { bearerToken: "synthetic-concurrent-token" });
      throw new Error("Synthetic metadata write failure");
    };
    await assert.rejects(
      f.service.save({ id: ID }, { apiKey: REPLACEMENT }),
      /Synthetic metadata write failure/,
    );
    assert.equal(f.calls.decrypt, 0);
    assert.deepEqual(await f.vault.get(ID), {
      bearerToken: "synthetic-concurrent-token",
    });
  });

  test(`${kind} failed clear cannot resurrect credentials after a concurrent explicit deletion`, async (t) => {
    const f = await fixture(t, kind);
    f.service.persist = async () => {
      await f.vault.delete(ID);
      throw new Error("Synthetic metadata write failure");
    };
    await assert.rejects(
      f.service.save({ id: ID }, {}),
      /Synthetic metadata write failure/,
    );
    assert.equal(await f.vault.snapshot(ID), null);
    assert.deepEqual(f.calls, { encrypt: 0, decrypt: 0 });
  });

  test(`${kind} blank credential fields leave unsafe entries intact and never decrypt them`, async (t) => {
    const f = await fixture(t, kind);
    await f.service.save({ id: ID, name: "Metadata only" }, { apiKey: "" });
    assert.equal(await f.vault.snapshot(ID), LEGACY);
    assert.deepEqual(f.calls, { encrypt: 0, decrypt: 0 });
  });

  test(`${kind} refuses unsafe replacement without encrypted rollback support`, async (t) => {
    const f = await fixture(t, kind);
    f.vault.snapshot = undefined;
    f.vault.restore = undefined;
    await assert.rejects(
      f.service.save({ id: ID }, { apiKey: REPLACEMENT }),
      /cifratura credenziali di Linux/,
    );
    assert.deepEqual(f.calls, { encrypt: 0, decrypt: 0 });
  });

  test(`${kind} refuses credential replacement after an unrelated native storage failure`, async (t) => {
    const f = await fixture(t, kind);
    f.vault.get = async () => {
      const error = new Error("Synthetic blocked storage request");
      error.code = "SECURE_STORAGE_BLOCKED";
      throw error;
    };
    await assert.rejects(
      f.service.save({ id: ID }, { apiKey: REPLACEMENT }),
      /Synthetic blocked storage request/,
    );
    assert.equal(await f.vault.snapshot(ID), LEGACY);
    assert.deepEqual(f.calls, { encrypt: 0, decrypt: 0 });
  });

  test(`${kind} refuses mutation when the encrypted backup is unavailable`, async (t) => {
    const f = await fixture(t, kind),
      snapshot = f.vault.snapshot.bind(f.vault);
    f.vault.snapshot = async () => undefined;
    await assert.rejects(
      f.service.save({ id: ID }, { apiKey: REPLACEMENT }),
      /Snapshot credenziali non valido/,
    );
    assert.equal(await snapshot(ID), LEGACY);
    assert.deepEqual(f.calls, { encrypt: 0, decrypt: 0 });
  });

  test(`${kind} preserves healthy partial credential updates and uses ciphertext rollback`, async (t) => {
    const f = await fixture(t, kind);
    await f.vault.set(ID, {
      apiKey: REPLACEMENT,
      bearerToken: "synthetic-original-token",
    });
    await f.service.save(
      { id: ID },
      { bearerToken: "synthetic-updated-token", apiKey: "" },
    );
    assert.deepEqual(await f.vault.get(ID), {
      apiKey: REPLACEMENT,
      bearerToken: "synthetic-updated-token",
    });
    const before = await f.vault.snapshot(ID);
    f.service.persist = async () => {
      throw new Error("Synthetic metadata write failure");
    };
    await assert.rejects(
      f.service.save({ id: ID }, { apiKey: "synthetic-next-token" }),
      /Synthetic metadata write failure/,
    );
    assert.equal(await f.vault.snapshot(ID), before);
  });

  test(`${kind} keeps plaintext rollback compatible with memory-only vaults`, async (t) => {
    const f = await fixture(t, kind),
      stored = new Map([[ID, { apiKey: REPLACEMENT }]]);
    f.service.vault = {
      has: async (id) => stored.has(id),
      get: async (id) => structuredClone(stored.get(id) || null),
      set: async (id, value) => stored.set(id, structuredClone(value)),
      delete: async (id) => stored.delete(id),
    };
    f.service.persist = async () => {
      throw new Error("Synthetic metadata write failure");
    };
    await assert.rejects(
      f.service.save({ id: ID }, { apiKey: "synthetic-next-token" }),
      /Synthetic metadata write failure/,
    );
    assert.deepEqual(stored.get(ID), { apiKey: REPLACEMENT });
    await assert.rejects(f.remove(), /Synthetic metadata write failure/);
    assert.deepEqual(stored.get(ID), { apiKey: REPLACEMENT });
  });
}
