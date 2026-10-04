/* Copyright (C) 2026 Davide Leopardi
 * SPDX-License-Identifier: GPL-3.0-only */

"use strict";

const fs = require("node:fs");
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

class AIVault {
  constructor({ directory, safeStorage }) {
    this.directory = path.resolve(directory);
    this.file = path.join(this.directory, "credentials.json");
    this.safeStorage = safeStorage;
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
  available() {
    return (
      this.safeStorage?.isEncryptionAvailable() &&
      this.safeStorage.getSelectedStorageBackend?.() !== "basic_text"
    );
  }
  read() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (
        data.version !== 1 ||
        !data.credentials ||
        typeof data.credentials !== "object" ||
        Array.isArray(data.credentials)
      )
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
    if (
      !credentials ||
      typeof credentials !== "object" ||
      Array.isArray(credentials) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(credentials))
    )
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
  persist(data) {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(this.directory, 0o700);
    const tmp = this.file + "." + randomUUID() + ".tmp";
    try {
      fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
      fs.chmodSync(this.file, 0o600);
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
  }
  has(id) {
    const data = this.read().credentials;
    return Object.hasOwn(data, this.id(id)) && typeof data[id] === "string";
  }
  get(id) {
    const data = this.read().credentials;
    const encrypted = Object.hasOwn(data, this.id(id)) ? data[id] : null;
    if (!encrypted) return null;
    if (!this.available())
      throw new Error(
        "La protezione credenziali del sistema non è disponibile. Sblocca il portachiavi e riapri Branchline.",
      );
    try {
      const parsed = JSON.parse(
        this.safeStorage.decryptString(Buffer.from(encrypted, "base64")),
      );
      return this.validate(parsed);
    } catch {
      throw new Error(
        "Impossibile sbloccare le credenziali AI. Importale nuovamente nel profilo.",
      );
    }
  }
  set(id, credentials) {
    this.id(id);
    const clean = this.validate(credentials);
    if (!this.available())
      throw new Error(
        "Il portachiavi del sistema non è disponibile: le credenziali non verranno salvate in chiaro.",
      );
    let encrypted;
    try {
      encrypted = this.safeStorage
        .encryptString(JSON.stringify(clean))
        .toString("base64");
    } catch {
      throw new Error(
        "Impossibile proteggere le credenziali AI nel portachiavi del sistema.",
      );
    }
    const data = this.read();
    data.credentials[id] = encrypted;
    this.persist(data);
  }
  delete(id) {
    const data = this.read();
    delete data.credentials[this.id(id)];
    this.persist(data);
  }
}

module.exports = { AIVault };
