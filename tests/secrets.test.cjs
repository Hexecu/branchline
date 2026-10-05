// Copyright (c) 2026 Davide Leopardi
// SPDX-License-Identifier: GPL-3.0-only

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
const PREFIX = Buffer.from("v11fixture-cipher:");

function mockStorage(overrides = {}) {
  let generation = 0;
  return {
    isEncryptionAvailable: () =>
      assert.fail("synchronous availability must never run"),
    encryptString: () => assert.fail("synchronous encryption must never run"),
    decryptString: () => assert.fail("synchronous decryption must never run"),
    isAsyncEncryptionAvailable: async () => true,
    // Synthetic metadata only; tests never initialize an OS credential backend.
    getSelectedStorageBackend: () => "gnome_libsecret",
    async encryptStringAsync(value) {
      const bytes = Buffer.from(value, "utf8");
      for (let i = 0; i < bytes.length; i++) bytes[i] ^= 0xb9;
      return Buffer.concat([PREFIX, Buffer.from([++generation % 256]), bytes]);
    },
    async decryptStringAsync(value) {
      assert.ok(Buffer.isBuffer(value), "safeStorage must receive a Buffer");
      if (!value.subarray(0, PREFIX.length).equals(PREFIX))
        throw new Error("Invalid fixture ciphertext");
      const bytes = Buffer.from(value.subarray(PREFIX.length + 1));
      for (let i = 0; i < bytes.length; i++) bytes[i] ^= 0xb9;
      return { result: bytes.toString("utf8"), shouldReEncrypt: false };
    },
    ...overrides,
  };
}

function fixture(t, safeStorage = mockStorage(), options = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "branchline-vault-test-"));
  const directory = path.join(base, "vault");
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return {
    directory,
    safeStorage,
    vault: new AIVault({ directory, safeStorage, ...options }),
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
    isAsyncEncryptionAvailable: async () => false,
    encryptStringAsync: async () =>
      assert.fail("encryption must not be attempted when unavailable"),
    decryptStringAsync: async () =>
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
    safeStorage: mockStorage({ isAsyncEncryptionAvailable: async () => false }),
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
  const encrypt = safeStorage.encryptStringAsync;
  safeStorage.encryptStringAsync = () => {
    throw new Error(`OS encryption failed: ${PROVIDER_ERROR}`);
  };
  await rejectsWithoutSecret(() =>
    vault.set("connection-a", { apiKey: SECOND }),
  );
  assert.deepEqual(
    diskFiles(directory).map((file) => fs.readFileSync(file)),
    original,
  );
  safeStorage.encryptStringAsync = encrypt;
  assert.deepEqual(await vault.get("connection-a"), { apiKey: FIRST });
  safeStorage.decryptStringAsync = () => {
    throw new Error(`OS decryption failed: ${PROVIDER_ERROR}`);
  };
  await rejectsWithoutSecret(() => vault.get("connection-a"));
  assertNoPlaintext(directory, [FIRST, SECOND, PROVIDER_ERROR]);
});

test("vault supports full-length namespaced public IDs without namespace collision", async (t) => {
  const { vault } = fixture(t);
  const id = "x".repeat(97);
  await vault.set(`ai-${id}`, { apiKey: FIRST });
  await vault.set(`db-${id}`, { bearerToken: SECOND });
  assert.deepEqual(await vault.get(`ai-${id}`), { apiKey: FIRST });
  assert.deepEqual(await vault.get(`db-${id}`), { bearerToken: SECOND });
  await rejectsWithoutSecret(() => vault.set(`ai-${id}x`, { apiKey: FIRST }));
});

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("native availability timeout returns false, metadata remains readable, and async missing does not use sync fallback", async (t) => {
  const never = new Promise(() => {});
  const storage = mockStorage({ isAsyncEncryptionAvailable: () => never });
  const { directory, vault } = fixture(t, storage, { timeoutMs: 35 });
  const start = Date.now();
  assert.equal(await vault.available(), false);
  assert(Date.now() - start < 300);
  assert.equal(await vault.has("ai-missing"), false);
  assert.deepEqual(diskFiles(directory), []);
  const legacy = mockStorage();
  delete legacy.isAsyncEncryptionAvailable;
  const oldVault = new AIVault({
    directory,
    safeStorage: legacy,
    timeoutMs: 35,
  });
  assert.equal(await oldVault.available(), false);
  await rejectsWithoutSecret(() =>
    oldVault.set("ai-legacy", { apiKey: FIRST }),
  );
});

test("availability and encryption timeouts cannot persist plaintext or late ciphertext", async (t) => {
  for (const target of ["isAsyncEncryptionAvailable", "encryptStringAsync"]) {
    const later = deferred(),
      storage = mockStorage({ [target]: () => later.promise });
    const { directory, vault } = fixture(t, storage, { timeoutMs: 35 });
    const start = Date.now();
    await rejectsWithoutSecret(() =>
      vault.set("ai-timeout", { apiKey: FIRST }),
    );
    assert(Date.now() - start < 300);
    assert.deepEqual(diskFiles(directory), []);
    later.resolve(
      target === "isAsyncEncryptionAvailable"
        ? true
        : await mockStorage().encryptStringAsync(
            JSON.stringify({ apiKey: FIRST }),
          ),
    );
    await delay(15);
    assert.deepEqual(
      diskFiles(directory),
      [],
      "timed-out native work must not write later",
    );
  }
});

test("async decrypt timeout preserves ciphertext and does not block other metadata reads", async (t) => {
  const storage = mockStorage(),
    { directory, vault: setupVault } = fixture(t, storage);
  await setupVault.set("ai-existing", { apiKey: FIRST });
  const vault = new AIVault({ directory, safeStorage: storage, timeoutMs: 35 });
  const before = fs.readFileSync(vault.file);
  storage.decryptStringAsync = () => new Promise(() => {});
  await rejectsWithoutSecret(() => vault.get("ai-existing"));
  assert.equal(await vault.has("ai-existing"), true);
  assert.deepEqual(fs.readFileSync(vault.file), before);
  assertNoPlaintext(directory, [FIRST]);
});

test("synthetic secure Linux backend supports encrypted roundtrips without OS access", async (t) => {
  const { vault, directory } = fixture(t, mockStorage(), { platform: "linux" });
  assert.equal(await vault.available(), true);
  await vault.set("ai-linux", { apiKey: FIRST });
  assert.deepEqual(await vault.get("ai-linux"), { apiKey: FIRST });
  assertNoPlaintext(directory, [FIRST]);
});

test("Linux basic_text, unknown, and missing secure backend fail closed without encryption", async (t) => {
  for (const backend of ["basic_text", "unknown", undefined]) {
    const storage = mockStorage({
      getSelectedStorageBackend:
        backend === undefined ? undefined : () => backend,
      encryptStringAsync: async () =>
        assert.fail("unsafe Linux backend cannot encrypt"),
    });
    const { directory, vault } = fixture(t, storage, { platform: "linux" });
    assert.equal(await vault.available(), false);
    await rejectsWithoutSecret(() => vault.set("ai-unsafe", { apiKey: FIRST }));
    assert.deepEqual(diskFiles(directory), []);
  }
});

test("concurrent native setters across vault instances preserve every namespace update", async (t) => {
  const storage = mockStorage(),
    encrypt = storage.encryptStringAsync;
  storage.encryptStringAsync = async (text) => {
    await delay(2);
    return encrypt(text);
  };
  const { directory, vault } = fixture(t, storage);
  const another = new AIVault({ directory, safeStorage: storage });
  await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      (index % 2 ? vault : another).set(
        `${index % 2 ? "ai" : "db"}-profile-${index}`,
        index % 2
          ? { apiKey: `${FIRST}-${index}` }
          : { bearerToken: `${SECOND}-${index}` },
      ),
    ),
  );
  for (let index = 0; index < 12; index++) {
    const key = `${index % 2 ? "ai" : "db"}-profile-${index}`;
    assert.equal(await vault.has(key), true);
    assert.deepEqual(
      await vault.get(key),
      index % 2
        ? { apiKey: `${FIRST}-${index}` }
        : { bearerToken: `${SECOND}-${index}` },
    );
  }
  assert.equal(
    Object.keys(JSON.parse(fs.readFileSync(vault.file, "utf8")).credentials)
      .length,
    12,
  );
  assertNoPlaintext(directory, [FIRST, SECOND]);
});

test("key rotation re-encrypts atomically and failed rotation preserves original ciphertext", async (t) => {
  const storage = mockStorage(),
    decrypt = storage.decryptStringAsync;
  const { vault } = fixture(t, storage);
  await vault.set("ai-rotate", { apiKey: FIRST });
  const before = JSON.parse(fs.readFileSync(vault.file, "utf8")).credentials[
    "ai-rotate"
  ];
  storage.decryptStringAsync = async (value) => ({
    ...(await decrypt(value)),
    shouldReEncrypt: true,
  });
  assert.deepEqual(await vault.get("ai-rotate"), { apiKey: FIRST });
  const rotated = JSON.parse(fs.readFileSync(vault.file, "utf8")).credentials[
    "ai-rotate"
  ];
  assert.notEqual(rotated, before);
  storage.encryptStringAsync = async () => {
    throw new Error(`OS rotation failed ${PROVIDER_ERROR}`);
  };
  await rejectsWithoutSecret(() => vault.get("ai-rotate"));
  assert.equal(
    JSON.parse(fs.readFileSync(vault.file, "utf8")).credentials["ai-rotate"],
    rotated,
  );
});

test("rotation cannot overwrite a concurrently updated or deleted credential", async (t) => {
  const storage = mockStorage(),
    decrypt = storage.decryptStringAsync;
  const { vault } = fixture(t, storage);
  await vault.set("ai-race", { apiKey: FIRST });
  for (const mutation of ["replace", "delete"]) {
    await vault.set("ai-race", { apiKey: FIRST });
    const readStarted = deferred(),
      release = deferred();
    storage.decryptStringAsync = async (value) => {
      const parsed = await decrypt(value);
      readStarted.resolve();
      await release.promise;
      return { ...parsed, shouldReEncrypt: true };
    };
    const reading = vault.get("ai-race");
    await readStarted.promise;
    // Native encryption waits behind the pending decrypt. Start the update
    // concurrently, release decryption, then check replacement wins rotation.
    const updating =
      mutation === "replace"
        ? vault.set("ai-race", { apiKey: SECOND })
        : vault.delete("ai-race");
    if (mutation === "delete") await updating;
    release.resolve();
    assert.deepEqual(await reading, { apiKey: FIRST });
    await updating;
    storage.decryptStringAsync = decrypt;
    assert.deepEqual(
      await vault.get("ai-race"),
      mutation === "replace" ? { apiKey: SECOND } : null,
    );
  }
});

test("queued native timeout does not later apply a request after its deadline", async (t) => {
  const release = deferred(),
    storage = mockStorage(),
    encrypt = storage.encryptStringAsync;
  storage.encryptStringAsync = (text) =>
    text.includes(FIRST) ? release.promise : encrypt(text);
  const { directory, vault } = fixture(t, storage, { timeoutMs: 35 });
  const outcomes = await Promise.allSettled([
    vault.set("ai-first", { apiKey: FIRST }),
    vault.set("db-second", { bearerToken: SECOND }),
  ]);
  assert(outcomes.every((value) => value.status === "rejected"));
  release.resolve(await encrypt(JSON.stringify({ apiKey: FIRST })));
  await delay(20);
  assert.deepEqual(diskFiles(directory), []);
});

test("native status is passive and reports unknown, pending, then cached availability", async (t) => {
  const started = deferred(),
    release = deferred();
  let probes = 0;
  const storage = mockStorage({
    isAsyncEncryptionAvailable() {
      probes++;
      started.resolve();
      return release.promise;
    },
  });
  const { vault } = fixture(t, storage);
  const another = fixture(t, storage).vault;
  for (let index = 0; index < 10; index++) {
    assert.equal(vault.status(), "unknown");
    assert.equal(another.status(), "unknown");
  }
  assert.equal(probes, 0, "status must never initialize native storage");
  const requests = [vault.available(), another.available(), vault.available()];
  await started.promise;
  assert.equal(vault.status(), "pending");
  assert.equal(another.status(), "pending");
  assert.equal(probes, 1, "instances must share one availability request");
  release.resolve(true);
  assert.deepEqual(await Promise.all(requests), [true, true, true]);
  assert.equal(vault.status(), "available");
  assert.equal(another.status(), "available");
  assert.equal(await another.available(), true);
  assert.equal(probes, 1, "successful availability must be cached");
});

test("unavailable native storage stays cached and legacy status never calls synchronous APIs", async (t) => {
  let probes = 0;
  const { vault } = fixture(
    t,
    mockStorage({
      isAsyncEncryptionAvailable: async () => {
        probes++;
        return false;
      },
    }),
  );
  assert.equal(vault.status(), "unknown");
  assert.equal(await vault.available(), false);
  assert.equal(vault.status(), "unavailable");
  for (let index = 0; index < 5; index++) {
    assert.equal(await vault.available(), false);
    await rejectsWithoutSecret(() =>
      vault.set("ai-disabled", { apiKey: FIRST }),
    );
  }
  assert.equal(probes, 1);
  const legacy = mockStorage();
  delete legacy.isAsyncEncryptionAvailable;
  assert.equal(fixture(t, legacy).vault.status(), "unavailable");
});

test("timed-out availability quarantines all instances and retries never create another native request", async (t) => {
  const release = deferred();
  const calls = { availability: 0, encrypt: 0, decrypt: 0 };
  const storage = mockStorage({
    isAsyncEncryptionAvailable() {
      calls.availability++;
      return release.promise;
    },
    encryptStringAsync() {
      calls.encrypt++;
      assert.fail("blocked storage must not encrypt");
    },
    decryptStringAsync() {
      calls.decrypt++;
      assert.fail("blocked storage must not decrypt");
    },
  });
  const { directory, vault } = fixture(t, storage, { timeoutMs: 35 });
  assert.equal(await vault.available(), false);
  assert.equal(vault.status(), "blocked");
  const another = fixture(t, storage, { timeoutMs: 35 }).vault;
  assert.equal(another.status(), "blocked");
  const retriesStarted = Date.now();
  for (let index = 0; index < 10; index++) {
    assert.equal(await another.available(), false);
    await assert.rejects(
      another.set(`db-retry-${index}`, { bearerToken: FIRST }),
      (error) =>
        error.code === "SECURE_STORAGE_BLOCKED" &&
        error.message.includes("Riavvia Branchline"),
    );
    assert.equal(await vault.get("ai-missing"), null);
  }
  assert(
    Date.now() - retriesStarted < 100,
    "blocked retries must fail immediately",
  );
  assert.deepEqual(calls, { availability: 1, encrypt: 0, decrypt: 0 });
  assert.equal(await vault.has("ai-missing"), false);
  await vault.delete("ai-missing");
  release.resolve(true);
  await delay(15);
  assert.equal(
    vault.status(),
    "blocked",
    "late approval must not release quarantine",
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(vault.file, "utf8")).credentials,
    {},
  );
  assertNoPlaintext(directory, [FIRST]);
});

test("timed-out encryption preserves ciphertext and blocks retries across vault files", async (t) => {
  const storage = mockStorage(),
    encrypt = storage.encryptStringAsync,
    release = deferred();
  let encryptions = 0;
  // Filesystem setup uses the normal deadline; only the pending native call
  // below needs the short timeout under test.
  const { directory, vault: setupVault } = fixture(t, storage);
  await setupVault.set("ai-existing", { apiKey: FIRST });
  const vault = new AIVault({ directory, safeStorage: storage, timeoutMs: 35 });
  const before = fs.readFileSync(vault.file);
  storage.encryptStringAsync = () => {
    encryptions++;
    return release.promise;
  };
  await assert.rejects(vault.set("ai-existing", { apiKey: SECOND }), (error) =>
    ["SECURE_STORAGE_TIMEOUT", "SECURE_STORAGE_BLOCKED"].includes(error.code),
  );
  assert.equal(vault.status(), "blocked");
  const another = fixture(t, storage, { timeoutMs: 35 });
  await assert.rejects(another.vault.set("db-other", { bearerToken: FIRST }), {
    code: "SECURE_STORAGE_BLOCKED",
  });
  await assert.rejects(vault.get("ai-existing"), {
    code: "SECURE_STORAGE_BLOCKED",
  });
  assert.equal(await vault.has("ai-existing"), true);
  assert.deepEqual(fs.readFileSync(vault.file), before);
  release.resolve(await encrypt(JSON.stringify({ apiKey: SECOND })));
  await delay(15);
  assert.equal(encryptions, 1);
  assert.equal(vault.status(), "blocked");
  assert.deepEqual(fs.readFileSync(vault.file), before);
  assert.deepEqual(diskFiles(another.directory), []);
  await setupVault.delete("ai-existing");
  assert.equal(await vault.has("ai-existing"), false);
  assertNoPlaintext(directory, [FIRST, SECOND]);
});

test("timed-out decryption quarantines native operations but leaves metadata deletion usable", async (t) => {
  const storage = mockStorage(),
    release = deferred();
  const { directory, vault: setupVault } = fixture(t, storage);
  await setupVault.set("ai-existing", { apiKey: FIRST });
  const vault = new AIVault({ directory, safeStorage: storage, timeoutMs: 35 });
  let decryptions = 0;
  storage.decryptStringAsync = () => {
    decryptions++;
    return release.promise;
  };
  await assert.rejects(vault.get("ai-existing"), (error) =>
    ["SECURE_STORAGE_TIMEOUT", "SECURE_STORAGE_BLOCKED"].includes(error.code),
  );
  assert.equal(vault.status(), "blocked");
  const another = new AIVault({ directory, safeStorage: storage });
  await assert.rejects(another.get("ai-existing"), {
    code: "SECURE_STORAGE_BLOCKED",
  });
  await assert.rejects(another.set("ai-new", { apiKey: SECOND }), {
    code: "SECURE_STORAGE_BLOCKED",
  });
  await another.delete("ai-existing");
  release.resolve({
    result: JSON.stringify({ apiKey: FIRST }),
    shouldReEncrypt: true,
  });
  await delay(15);
  assert.equal(decryptions, 1);
  assert.equal(vault.status(), "blocked");
  assert.equal(await vault.has("ai-existing"), false);
  assertNoPlaintext(directory, [FIRST, SECOND]);
});

test("native encryption and decryption never overlap across instances and vault files", async (t) => {
  const storage = mockStorage();
  let active = 0,
    maximum = 0,
    calls = 0;
  for (const method of [
    "isAsyncEncryptionAvailable",
    "encryptStringAsync",
    "decryptStringAsync",
  ]) {
    const original = storage[method];
    storage[method] = async (...args) => {
      calls++;
      maximum = Math.max(maximum, ++active);
      try {
        await delay(1);
        return await original(...args);
      } finally {
        active--;
      }
    };
  }
  const first = fixture(t, storage).vault,
    second = fixture(t, storage).vault;
  await Promise.all([
    first.set("ai-first", { apiKey: FIRST }),
    second.set("db-second", { bearerToken: SECOND }),
  ]);
  const values = await Promise.all([
    first.get("ai-first"),
    second.get("db-second"),
    first.set("ai-other", { apiKey: SECOND }),
    second.set("db-other", { bearerToken: FIRST }),
  ]);
  assert.deepEqual(values.slice(0, 2), [
    { apiKey: FIRST },
    { bearerToken: SECOND },
  ]);
  assert.equal(maximum, 1);
  assert.equal(active, 0);
  assert.equal(calls, 7, "one availability, four encryptions, two decryptions");
  assert.equal(first.status(), "available");
  assert.equal(second.status(), "available");
});

test("a queued native timeout blocks the active request and never starts queued encryption", async (t) => {
  const storage = mockStorage(),
    release = deferred(),
    started = deferred();
  const { directory, vault: setupVault } = fixture(t, storage);
  await setupVault.set("ai-existing", { apiKey: FIRST });
  const first = new AIVault({ directory, safeStorage: storage, timeoutMs: 500 });
  storage.decryptStringAsync = () => {
    started.resolve();
    return release.promise;
  };
  let encryptions = 0;
  const encrypt = storage.encryptStringAsync;
  storage.encryptStringAsync = (...args) => {
    encryptions++;
    return encrypt(...args);
  };
  const reading = first.get("ai-existing");
  await started.promise;
  const second = fixture(t, storage, { timeoutMs: 35 });
  const results = await Promise.allSettled([
    reading,
    second.vault.set("db-queued", { bearerToken: SECOND }),
  ]);
  assert(results.every((result) => result.status === "rejected"));
  assert.equal(first.status(), "blocked");
  assert.equal(second.vault.status(), "blocked");
  assert.equal(encryptions, 0);
  release.resolve({
    result: JSON.stringify({ apiKey: FIRST }),
    shouldReEncrypt: false,
  });
  await delay(15);
  assert.equal(encryptions, 0, "late completion must not unlock queued work");
  assert.deepEqual(diskFiles(second.directory), []);
});

test("quarantine is scoped to the native storage identity without poisoning independent mock backends", async (t) => {
  const blocked = fixture(
    t,
    mockStorage({ isAsyncEncryptionAvailable: () => new Promise(() => {}) }),
    { timeoutMs: 35 },
  ).vault;
  assert.equal(await blocked.available(), false);
  assert.equal(blocked.status(), "blocked");
  const independent = fixture(t).vault;
  assert.equal(independent.status(), "unknown");
  await independent.set("ai-separate", { apiKey: FIRST });
  assert.deepEqual(await independent.get("ai-separate"), { apiKey: FIRST });
  assert.equal(independent.status(), "available");
  assert.equal(blocked.status(), "blocked");
});

function cipherStorage(prefix) {
  const storage = mockStorage(), encrypt = storage.encryptStringAsync,
    decrypt = storage.decryptStringAsync;
  storage.encryptStringAsync = async value => {
    const bytes = await encrypt(value);
    return Buffer.concat([Buffer.from(prefix), bytes.subarray(3)]);
  };
  storage.decryptStringAsync = async value =>
    decrypt(Buffer.concat([Buffer.from("v11"), value.subarray(3)]));
  return storage;
}

test("Linux refuses public fixed-key and unknown cipher formats despite configured GNOME availability", async (t) => {
  for (const prefix of ["v10", "v99"]) {
    const storage = cipherStorage(prefix), encrypt = storage.encryptStringAsync;
    let encryptions = 0;
    storage.encryptStringAsync = async value => { encryptions++; return encrypt(value); };
    const { directory, vault } = fixture(t, storage, { platform: "linux" });
    assert.equal(await vault.available(), true, "backend label is only provisional");
    await assert.rejects(vault.set("ai-weak", { apiKey: FIRST }), { code: "SECURE_STORAGE_INSECURE" });
    assert.equal(vault.status(), "unavailable");
    assert.equal(await vault.available(), false);
    await rejectsWithoutSecret(() => vault.set("ai-retry", { apiKey: SECOND }));
    assert.equal(encryptions, 1, "weak native provider must not be retried");
    assert.deepEqual(diskFiles(directory), []);
  }
});

test("Linux fallback on overwrite preserves safe ciphertext and leaves metadata deletion usable", async (t) => {
  const storage = mockStorage();
  const { directory, vault } = fixture(t, storage, { platform: "linux" });
  await vault.set("ai-existing", { apiKey: FIRST });
  const before = fs.readFileSync(vault.file);
  storage.encryptStringAsync = cipherStorage("v10").encryptStringAsync;
  await assert.rejects(vault.set("ai-existing", { apiKey: SECOND }), { code: "SECURE_STORAGE_INSECURE" });
  assert.deepEqual(fs.readFileSync(vault.file), before);
  const another = new AIVault({ directory, safeStorage: storage, platform: "linux" });
  assert.equal(await another.available(), false);
  assert.equal(await another.has("ai-existing"), true);
  await another.delete("ai-existing");
  assert.equal(await vault.has("ai-existing"), false);
  assertNoPlaintext(directory, [FIRST, SECOND]);
});

test("Linux never decrypts old weak ciphertext and permits safe credential reimport", async (t) => {
  for (const prefix of ["v10", "v99"]) {
    const storage = mockStorage(), decrypt = storage.decryptStringAsync;
    let decryptions = 0;
    storage.decryptStringAsync = async value => { decryptions++; return decrypt(value); };
    const { vault } = fixture(t, storage, { platform: "linux" });
    await vault.set("ai-existing", { apiKey: FIRST });
    const data = JSON.parse(fs.readFileSync(vault.file, "utf8"));
    const bytes = Buffer.from(data.credentials["ai-existing"], "base64");
    data.credentials["ai-existing"] = Buffer.concat([Buffer.from(prefix), bytes.subarray(3)]).toString("base64");
    fs.writeFileSync(vault.file, JSON.stringify(data));
    const before = fs.readFileSync(vault.file);
    await assert.rejects(vault.get("ai-existing"), { code: "SECURE_STORAGE_INSECURE" });
    assert.equal(decryptions, 0);
    assert.deepEqual(fs.readFileSync(vault.file), before);
    await vault.set("ai-existing", { apiKey: SECOND });
    assert.deepEqual(await vault.get("ai-existing"), { apiKey: SECOND });
    assert.equal(decryptions, 1);
  }
});

test("Linux rotation cannot return credentials or persist a weak replacement", async (t) => {
  const storage = mockStorage(), decrypt = storage.decryptStringAsync;
  const { vault, directory } = fixture(t, storage, { platform: "linux" });
  await vault.set("ai-rotate", { apiKey: FIRST });
  const before = fs.readFileSync(vault.file);
  storage.decryptStringAsync = async value => ({ ...(await decrypt(value)), shouldReEncrypt: true });
  storage.encryptStringAsync = cipherStorage("v10").encryptStringAsync;
  await assert.rejects(vault.get("ai-rotate"), { code: "SECURE_STORAGE_INSECURE" });
  assert.deepEqual(fs.readFileSync(vault.file), before);
  assert.equal(vault.status(), "unavailable");
  assertNoPlaintext(directory, [FIRST]);
});

test("Linux portal v12 roundtrips and OS-native v10 remains supported on macOS and Windows", async (t) => {
  for (const [platform, prefix] of [["linux", "v12"], ["darwin", "v10"], ["win32", "v10"]]) {
    const { vault, directory } = fixture(t, cipherStorage(prefix), { platform });
    await vault.set("ai-valid", { apiKey: FIRST });
    assert.deepEqual(await vault.get("ai-valid"), { apiKey: FIRST });
    assert.equal(vault.status(), "available");
    assertNoPlaintext(directory, [FIRST]);
  }
});
