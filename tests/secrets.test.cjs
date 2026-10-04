/* Copyright (C) 2026 Davide Leopardi
 * SPDX-License-Identifier: GPL-3.0-only */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { AIVault } = require("../electron/ai-vault.cjs");

// Reversible fixture only: production encryption belongs to Electron safeStorage.
// These markers are synthetic; the test never reads credentials or environment.
const FIRST = "unit-test-secret-first-725b";
const SECOND = "unit-test-secret-second-a861";
const PROVIDER_ERROR = "unit-test-secret-provider-error-304c";
const PREFIX = Buffer.from("fixture-cipher:");

function mockStorage(overrides = {}) {
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const bytes = Buffer.from(value, "utf8");
      for (let i = 0; i < bytes.length; i++) bytes[i] ^= 0xb9;
      return Buffer.concat([PREFIX, bytes]);
    },
    decryptString(value) {
      assert.ok(Buffer.isBuffer(value), "safeStorage must receive a Buffer");
      if (!value.subarray(0, PREFIX.length).equals(PREFIX)) {
        throw new Error("Invalid fixture ciphertext");
      }
      const bytes = Buffer.from(value.subarray(PREFIX.length));
      for (let i = 0; i < bytes.length; i++) bytes[i] ^= 0xb9;
      return bytes.toString("utf8");
    },
    ...overrides,
  };
}

function fixture(t, safeStorage = mockStorage()) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "branchline-vault-test-"));
  const directory = path.join(base, "vault");
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return {
    directory,
    safeStorage,
    vault: new AIVault({ directory, safeStorage }),
  };
}

function diskFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).map((name) => path.join(directory, name));
}

function assertNoPlaintext(directory, values) {
  for (const file of diskFiles(directory)) {
    assert.equal(fs.statSync(file).isFile(), true);
    const bytes = fs.readFileSync(file);
    for (const value of values) {
      assert.equal(
        bytes.includes(Buffer.from(value)),
        false,
        "plaintext reached vault storage",
      );
    }
  }
}

async function rejectsWithoutSecret(
  operation,
  secrets = [FIRST, SECOND, PROVIDER_ERROR],
) {
  await assert.rejects(
    async () => operation(),
    (error) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.trim(), "failure must be explicit");
      const exposed = `${error.message}\n${error.stack || ""}`;
      for (const secret of secrets)
        assert.equal(exposed.includes(secret), false, "error exposes a secret");
      return true;
    },
  );
}

test("vault roundtrips encrypted credentials across reloads with private file permissions", async (t) => {
  const { directory, safeStorage, vault } = fixture(t);
  const credentials = {
    apiKey: FIRST,
    bearerToken: SECOND,
    serviceAccount: JSON.stringify({
      type: "service_account",
      private_key: "fixture-only-private-key",
    }),
  };
  assert.equal(await vault.get("azure-test"), null);
  assert.equal(await vault.has("azure-test"), false);
  await vault.set("azure-test", credentials);
  assert.equal(await vault.has("azure-test"), true);
  assert.deepEqual(await vault.get("azure-test"), credentials);
  const reloaded = new AIVault({ directory, safeStorage });
  assert.deepEqual(await reloaded.get("azure-test"), credentials);
  const files = diskFiles(directory);
  assert.equal(
    files.length,
    1,
    "atomic writes must leave only the current vault file",
  );
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(files[0], "utf8")));
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
    assert.equal(fs.statSync(files[0]).mode & 0o777, 0o600);
  }
  assertNoPlaintext(directory, [
    FIRST,
    SECOND,
    "fixture-only-private-key",
    JSON.stringify(credentials),
  ]);
});

test("vault replacement and deletion clear old values without disturbing another connection", async (t) => {
  const { directory, safeStorage, vault } = fixture(t);
  await vault.set("connection-a", { apiKey: FIRST, bearerToken: SECOND });
  await vault.set("connection-b", {
    accessKeyId: "fixture-access-id",
    secretAccessKey: SECOND,
    sessionToken: FIRST,
  });
  await vault.set("connection-a", { apiKey: "fixture-replacement-secret" });
  assert.deepEqual(await vault.get("connection-a"), {
    apiKey: "fixture-replacement-secret",
  });
  assert.deepEqual(await vault.get("connection-b"), {
    accessKeyId: "fixture-access-id",
    secretAccessKey: SECOND,
    sessionToken: FIRST,
  });
  await vault.delete("connection-a");
  await vault.delete("connection-a");
  assert.equal(await vault.get("connection-a"), null);
  assert.equal(await vault.has("connection-a"), false);
  const reloaded = new AIVault({ directory, safeStorage });
  assert.equal(await reloaded.get("connection-a"), null);
  assert.equal(await reloaded.has("connection-b"), true);
  assert.equal(
    diskFiles(directory).length,
    1,
    "replacement must not leave temporary copies",
  );
  assertNoPlaintext(directory, [FIRST, SECOND, "fixture-replacement-secret"]);
});

test("vault refuses plaintext fallback when secure encryption is unavailable", async (t) => {
  const disabled = mockStorage({
    isEncryptionAvailable: () => false,
    encryptString: () =>
      assert.fail("encryption must not be attempted when unavailable"),
    decryptString: () =>
      assert.fail("decryption must not be attempted when unavailable"),
  });
  const { directory, vault } = fixture(t, disabled);
  await rejectsWithoutSecret(() =>
    vault.set("connection-a", { apiKey: FIRST }),
  );
  assert.equal(diskFiles(directory).length, 0);
});

test("vault reports existing encrypted credentials as inaccessible when secure storage is unavailable", async (t) => {
  const { directory, vault } = fixture(t);
  await vault.set("connection-a", { apiKey: FIRST });
  const original = diskFiles(directory).map((file) => fs.readFileSync(file));
  const unavailable = new AIVault({
    directory,
    safeStorage: mockStorage({ isEncryptionAvailable: () => false }),
  });
  await rejectsWithoutSecret(() => unavailable.get("connection-a"));
  assert.deepEqual(
    diskFiles(directory).map((file) => fs.readFileSync(file)),
    original,
  );
  assertNoPlaintext(directory, [FIRST]);
});

test("vault rejects malformed credential types without overwriting saved credentials", async (t) => {
  const { directory, vault } = fixture(t);
  await vault.set("connection-a", { apiKey: FIRST });
  const malformed = [
    null,
    undefined,
    FIRST,
    17,
    [],
    ["apiKey", FIRST],
    { apiKey: null },
    { apiKey: 17 },
    { apiKey: true },
    { apiKey: [FIRST] },
    { apiKey: { value: FIRST } },
    { serviceAccount: { private_key: FIRST } },
    new Date(0),
    new Map([["apiKey", FIRST]]),
  ];
  for (const credentials of malformed) {
    await rejectsWithoutSecret(() => vault.set("connection-a", credentials));
    assert.deepEqual(await vault.get("connection-a"), { apiKey: FIRST });
  }
  assertNoPlaintext(directory, [FIRST]);
});

test("vault rejects reserved profile IDs across all methods without corrupting saved credentials", async (t) => {
  const { directory, vault } = fixture(t);
  await vault.set("valid-connection", { apiKey: FIRST });
  const original = diskFiles(directory).map((file) => fs.readFileSync(file));
  for (const id of ["__proto__", "constructor", "toString"]) {
    for (const operation of [
      () => vault.set(id, { apiKey: SECOND }),
      () => vault.get(id),
      () => vault.has(id),
      () => vault.delete(id),
    ])
      await rejectsWithoutSecret(operation);
  }
  assert.deepEqual(
    diskFiles(directory).map((file) => fs.readFileSync(file)),
    original,
  );
  assert.deepEqual(await vault.get("valid-connection"), { apiKey: FIRST });
  assertNoPlaintext(directory, [FIRST, SECOND]);
});

test("vault sanitizes secure-storage exceptions and preserves existing ciphertext after a failed overwrite", async (t) => {
  const safeStorage = mockStorage();
  const { directory, vault } = fixture(t, safeStorage);
  await vault.set("connection-a", { apiKey: FIRST });
  const original = diskFiles(directory).map((file) => fs.readFileSync(file));
  const encrypt = safeStorage.encryptString;
  safeStorage.encryptString = () => {
    throw new Error(`OS encryption failed: ${PROVIDER_ERROR}`);
  };
  await rejectsWithoutSecret(() =>
    vault.set("connection-a", { apiKey: SECOND }),
  );
  assert.deepEqual(
    diskFiles(directory).map((file) => fs.readFileSync(file)),
    original,
  );
  safeStorage.encryptString = encrypt;
  assert.deepEqual(await vault.get("connection-a"), { apiKey: FIRST });
  safeStorage.decryptString = () => {
    throw new Error(`OS decryption failed: ${PROVIDER_ERROR}`);
  };
  await rejectsWithoutSecret(() => vault.get("connection-a"));
  assertNoPlaintext(directory, [FIRST, SECOND, PROVIDER_ERROR]);
});
