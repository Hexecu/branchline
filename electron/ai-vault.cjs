// Copyright (c) 2026 Davide Leopardi
// SPDX-License-Identifier: GPL-3.0-only

"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const fields = new Set([
  "apiKey",
  "bearerToken",
  "accessKeyId",
  "secretAccessKey",
  "sessionToken",
  "serviceAccount",
]);
const DEFAULT_TIMEOUT_MS = 8000;
// All vault instances in this process share the mutation queue for one file.
// Native OS encryption is asynchronous; updates must re-read metadata after it
// finishes so simultaneous AI/database saves cannot discard each other's keys.
const mutations = new Map();
// A receipt identifies the exact in-process mutation even when two deletions
// both yield null or two encryptions produce identical ciphertext (Linux CBC).
const receipts = new Map();
function mutationReceipt(file, id, ciphertext) {
  let entries = receipts.get(file);
  if (!entries) receipts.set(file, entries = new Map());
  const receipt = Object.freeze({ ciphertext });
  entries.set(id, receipt);
  return receipt;
}
// A caller deadline cannot cancel Electron's native Keychain request. Keep the
// native queue alive until that request actually settles, and quarantine the
// shared storage object after a timeout so retries cannot stack OS prompts.
const nativeStates = new WeakMap();
const nativeMethods = [
  "isAsyncEncryptionAvailable",
  "encryptStringAsync",
  "decryptStringAsync",
];
function supported(storage) {
  return (
    storage &&
    ["object", "function"].includes(typeof storage) &&
    nativeMethods.every((method) => typeof storage[method] === "function")
  );
}
function nativeState(storage) {
  let state = nativeStates.get(storage);
  if (!state) {
    state = {
      availability: null,
      availabilityPromise: null,
      pending: 0,
      blocked: false,
      queue: Promise.resolve(),
      blockedListeners: new Set(),
    };
    nativeStates.set(storage, state);
  }
  return state;
}
function blockNative(state) {
  if (state.blocked) return;
  state.blocked = true;
  for (const listener of state.blockedListeners) listener();
  state.blockedListeners.clear();
}
function blockedError() {
  const error = new Error(
    "Il portachiavi del sistema ha una richiesta ancora sospesa. Riavvia Branchline prima di riprovare.",
  );
  error.code = "SECURE_STORAGE_BLOCKED";
  return error;
}
function nativeReady(state) {
  if (state.blocked) throw blockedError();
}
function insecureError() {
  const error = new Error(
    "La cifratura credenziali di Linux non è sicura. Sblocca il portachiavi, riapri l’app e importa nuovamente le credenziali.",
  );
  error.code = "SECURE_STORAGE_INSECURE";
  return error;
}
function plain(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  );
}
function timeoutError() {
  const error = new Error(
    "Il portachiavi del sistema non risponde entro il tempo massimo. Riavvia Branchline prima di riprovare.",
  );
  error.code = "SECURE_STORAGE_TIMEOUT";
  return error;
}
function context(timeoutMs) {
  return { expiresAt: Date.now() + timeoutMs, cancelled: false };
}
function check(deadline) {
  if (deadline.cancelled || Date.now() >= deadline.expiresAt)
    throw timeoutError();
}
async function bounded(operation, deadline, onTimeout) {
  check(deadline);
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        check(deadline);
        return operation();
      }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => {
            deadline.cancelled = true;
            reject(timeoutError());
            onTimeout?.();
          },
          Math.max(1, deadline.expiresAt - Date.now()),
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function nativeOperation(storage, operation, deadline) {
  const state = nativeState(storage);
  nativeReady(state);
  check(deadline);
  state.pending++;
  const task = state.queue.then(() => {
    nativeReady(state);
    check(deadline);
    return operation();
  });
  // Do not replace this queue with the deadline race: an OS operation can keep
  // running after its caller timed out. No other native call may overlap it.
  state.queue = task.then(
    () => {
      state.pending--;
    },
    () => {
      state.pending--;
    },
  );
  let rejectBlocked;
  const interrupted = new Promise((_, reject) => {
    rejectBlocked = () => reject(blockedError());
    state.blockedListeners.add(rejectBlocked);
  });
  try {
    return await bounded(
      () => Promise.race([task, interrupted]),
      deadline,
      () => blockNative(state),
    );
  } finally {
    state.blockedListeners.delete(rejectBlocked);
  }
}

class AIVault {
  constructor({
    directory,
    safeStorage,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    platform = process.platform,
  }) {
    if (typeof directory !== "string" || !directory || directory.includes("\0"))
      throw new Error("Percorso archivio credenziali non valido.");
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000)
      throw new Error("Timeout portachiavi non valido.");
    this.directory = path.resolve(directory);
    this.file = path.join(this.directory, "credentials.json");
    this.safeStorage = safeStorage;
    this.timeoutMs = timeoutMs;
    this.platform = platform;
  }
  id(id) {
    if (
      typeof id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(id) ||
      Object.prototype.hasOwnProperty.call(Object.prototype, id)
    )
      throw new Error("Identificativo del profilo AI non valido.");
    return id;
  }
  status() {
    if (!supported(this.safeStorage)) return "unavailable";
    const state = nativeState(this.safeStorage);
    if (state.blocked) return "blocked";
    if (state.pending) return "pending";
    if (state.availability === true) return "available";
    if (state.availability === false) return "unavailable";
    return "unknown";
  }
  assertNativeReady() {
    if (supported(this.safeStorage)) nativeReady(nativeState(this.safeStorage));
  }
  quarantinePendingNative() {
    if (!supported(this.safeStorage)) return;
    const state = nativeState(this.safeStorage);
    if (state.pending) blockNative(state);
  }
  async available(deadline = context(this.timeoutMs)) {
    const storage = this.safeStorage;
    // Never call synchronous encryption APIs, including the synchronous
    // availability probe: they can block Electron while Keychain requests input.
    if (!supported(storage)) return false;
    const state = nativeState(storage);
    if (state.blocked) return false;
    if (state.availability !== null) return state.availability;
    try {
      if (!state.availabilityPromise) {
        state.availabilityPromise = nativeOperation(
          storage,
          () => storage.isAsyncEncryptionAvailable(),
          deadline,
        ).then((result) => {
          nativeReady(state);
          let available = result === true;
          // Backend metadata is only a preliminary check: async Chromium can
          // report GNOME yet silently fall back to its public fixed key. Actual
          // Linux ciphertext is checked before saving or decrypting below.
          if (available && this.platform === "linux") {
            available =
              typeof storage.getSelectedStorageBackend === "function" &&
              !["basic_text", "unknown"].includes(
                storage.getSelectedStorageBackend(),
              );
          }
          state.availability = available;
          return available;
        });
      }
      return await bounded(
        () => state.availabilityPromise,
        deadline,
        () => blockNative(state),
      );
    } catch (error) {
      if (error.code === "SECURE_STORAGE_TIMEOUT") blockNative(state);
      else if (!state.blocked) state.availability = false;
      return false;
    }
  }
  async read() {
    try {
      const data = JSON.parse(await fs.readFile(this.file, "utf8"));
      if (!plain(data) || data.version !== 1 || !plain(data.credentials))
        throw new Error("invalid");
      return data;
    } catch (error) {
      if (error.code === "ENOENT") return { version: 1, credentials: {} };
      throw new Error(
        "Archivio credenziali AI non leggibile. Ripristina il file o importa nuovamente le credenziali.",
      );
    }
  }
  validate(credentials) {
    if (!plain(credentials))
      throw new Error("Formato delle credenziali AI non valido.");
    const clean = {};
    for (const [key, value] of Object.entries(credentials)) {
      if (!fields.has(key) || typeof value !== "string" || value.length > 65536)
        throw new Error("Campo delle credenziali AI non valido.");
      if (value.trim()) clean[key] = value;
    }
    if (JSON.stringify(clean).length > 131072)
      throw new Error("Credenziali AI troppo grandi.");
    return clean;
  }
  async persist(data, deadline) {
    check(deadline);
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    await fs.chmod(this.directory, 0o700);
    const temporary = this.file + "." + randomUUID() + ".tmp";
    try {
      check(deadline);
      await fs.writeFile(temporary, JSON.stringify(data), {
        mode: 0o600,
        flag: "wx",
      });
      await fs.chmod(temporary, 0o600);
      check(deadline);
      await fs.rename(temporary, this.file);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
  async mutate(operation, deadline) {
    const previous = mutations.get(this.file) || Promise.resolve();
    const task = previous
      .catch(() => {})
      .then(() => {
        check(deadline);
        return operation();
      });
    mutations.set(this.file, task);
    task
      .finally(() => {
        if (mutations.get(this.file) === task) mutations.delete(this.file);
      })
      .catch(() => {});
    // A request waiting behind a blocked native operation also has a deadline.
    // Cancelling its context prevents the queued callback from persisting later.
    return bounded(() => task, deadline);
  }
  async has(id) {
    this.id(id);
    const data = (await this.read()).credentials;
    return Object.hasOwn(data, id) && typeof data[id] === "string";
  }
  assertSecureCiphertext(encrypted, fresh = false) {
    // Electron 44 / Chromium 152: v11 is SecretService/KWallet, v12 is
    // SecretPortal. Linux v10 uses a public fixed key; unknown formats also
    // fail closed. macOS/Windows v10 belongs to different, secure OS providers.
    if (
      this.platform === "linux" &&
      !["v11", "v12"].includes(encrypted.subarray(0, 3).toString("utf8"))
    ) {
      // A newly generated weak cipher proves this native provider unavailable.
      // An old weak entry alone must not prevent importing a safe replacement.
      if (fresh) nativeState(this.safeStorage).availability = false;
      throw insecureError();
    }
  }
  // Internal profile transactions keep encrypted rollback data without asking
  // the OS to decrypt an entry that has already failed the safety check.
  async snapshot(id) {
    this.id(id);
    const data = (await this.read()).credentials;
    const value = Object.hasOwn(data, id) ? data[id] : null;
    if (value !== null && typeof value !== "string")
      throw new Error("Formato archivio credenziali non valido.");
    return value;
  }
  async restore(id, snapshot, expected) {
    this.id(id);
    if (
      (snapshot !== null && typeof snapshot !== "string") ||
      !plain(expected) ||
      (expected.ciphertext !== null && typeof expected.ciphertext !== "string")
    ) throw new Error("Formato archivio credenziali non valido.");
    const deadline = context(this.timeoutMs);
    return this.mutate(async () => {
      const latest = await this.read();
      const current = Object.hasOwn(latest.credentials, id)
        ? latest.credentials[id] : null;
      // A concurrent replacement/deletion wins over an older profile rollback.
      if (current !== expected.ciphertext || receipts.get(this.file)?.get(id) !== expected)
        return false;
      if (snapshot === null) delete latest.credentials[id];
      else latest.credentials[id] = snapshot;
      await this.persist(latest, deadline);
      mutationReceipt(this.file, id, snapshot);
      return true;
    }, deadline);
  }
  async encrypt(clean, deadline) {
    const encrypted = await nativeOperation(
      this.safeStorage,
      () => this.safeStorage.encryptStringAsync(JSON.stringify(clean)),
      deadline,
    );
    if (!Buffer.isBuffer(encrypted) || !encrypted.length)
      throw new Error("Cifratura non valida.");
    this.assertSecureCiphertext(encrypted, true);
    return encrypted.toString("base64");
  }
  async get(id) {
    this.id(id);
    const deadline = context(this.timeoutMs);
    const data = (await this.read()).credentials;
    const encrypted = Object.hasOwn(data, id) ? data[id] : null;
    if (!encrypted) return null;
    this.assertNativeReady();
    if (!(await this.available(deadline))) {
      this.assertNativeReady();
      throw new Error(
        "La protezione credenziali del sistema non è disponibile. Sblocca il portachiavi e riapri Branchline.",
      );
    }
    try {
      const ciphertext = Buffer.from(encrypted, "base64");
      this.assertSecureCiphertext(ciphertext);
      const decrypted = await nativeOperation(
        this.safeStorage,
        () =>
          this.safeStorage.decryptStringAsync(ciphertext),
        deadline,
      );
      if (
        !plain(decrypted) ||
        typeof decrypted.result !== "string" ||
        typeof decrypted.shouldReEncrypt !== "boolean"
      )
        throw new Error("Decifratura non valida.");
      const clean = this.validate(JSON.parse(decrypted.result));
      if (decrypted.shouldReEncrypt) {
        // Re-encrypt with the current key, keeping the old ciphertext intact on
        // errors/timeouts. A concurrent replacement/deletion always wins over
        // rotation of the older value, including across in-process instances.
        const rotated = await this.encrypt(clean, deadline);
        await this.mutate(async () => {
          const latest = await this.read();
          if (latest.credentials[id] !== encrypted) return;
          latest.credentials[id] = rotated;
          await this.persist(latest, deadline);
          mutationReceipt(this.file, id, rotated);
        }, deadline);
      }
      return clean;
    } catch (error) {
      if (error.code === "SECURE_STORAGE_TIMEOUT") throw timeoutError();
      if (error.code === "SECURE_STORAGE_BLOCKED") throw blockedError();
      if (error.code === "SECURE_STORAGE_INSECURE") throw insecureError();
      throw new Error(
        "Impossibile sbloccare le credenziali AI. Importale nuovamente nel profilo.",
      );
    }
  }
  async set(id, credentials) {
    this.id(id);
    const clean = this.validate(credentials),
      deadline = context(this.timeoutMs);
    this.assertNativeReady();
    try {
      return await this.mutate(async () => {
        if (!(await this.available(deadline))) {
          this.assertNativeReady();
          throw new Error("Unavailable");
        }
        const encrypted = await this.encrypt(clean, deadline);
        check(deadline);
        const latest = await this.read();
        latest.credentials[id] = encrypted;
        await this.persist(latest, deadline);
        return mutationReceipt(this.file, id, encrypted);
      }, deadline);
    } catch (error) {
      if (error.code === "SECURE_STORAGE_TIMEOUT") {
        this.quarantinePendingNative();
        throw timeoutError();
      }
      if (error.code === "SECURE_STORAGE_BLOCKED") throw blockedError();
      if (error.code === "SECURE_STORAGE_INSECURE") throw insecureError();
      throw new Error(
        "Impossibile proteggere le credenziali nel portachiavi del sistema. Non verranno salvate in chiaro.",
      );
    }
  }
  async delete(id) {
    this.id(id);
    const deadline = context(this.timeoutMs);
    return this.mutate(async () => {
      const latest = await this.read();
      delete latest.credentials[id];
      await this.persist(latest, deadline);
      return mutationReceipt(this.file, id, null);
    }, deadline);
  }
}

// Browser QA never persists credentials; production uses native safeStorage.
class MemoryVault {
  constructor() {
    this.entries = new Map();
  }
  id(id) {
    return AIVault.prototype.id.call(this, id);
  }
  has(id) {
    return this.entries.has(this.id(id));
  }
  get(id) {
    const value = this.entries.get(this.id(id));
    return value ? structuredClone(value) : null;
  }
  set(id, credentials) {
    this.entries.set(
      this.id(id),
      AIVault.prototype.validate.call(this, credentials),
    );
  }
  delete(id) {
    this.entries.delete(this.id(id));
  }
}
module.exports = { AIVault, MemoryVault, DEFAULT_TIMEOUT_MS };
