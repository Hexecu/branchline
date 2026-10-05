/* Copyright (C) 2026 Davide Leopardi
 * SPDX-License-Identifier: GPL-3.0-only */

"use strict";

// Read-only native hosting APIs. Credentials belong to the injected encrypted
// vault; repository remotes are never treated as a source of API credentials.
// https://docs.github.com/en/rest/pulls/pulls
// https://docs.gitlab.com/api/merge_requests/
// https://developer.atlassian.com/cloud/bitbucket/rest/
// https://developer.atlassian.com/server/bitbucket/rest/v1000/api-group-pull-requests/
// https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-requests/get-pull-requests
// https://docs.gitea.com/development/api-usage/
// https://forgejo.org/docs/latest/user/api/usage/

const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { randomUUID } = require("node:crypto");
const runFile = promisify(execFile);
const MAX_BODY = 3 * 1024 * 1024;
const MAX_ITEMS = 50;
const MAX_PAGES = 5;
const MODES = {
  github: ["token", "bearer", "gh", "none"],
  gitlab: ["token", "bearer", "none"],
  "bitbucket-cloud": ["basic", "bearer", "none"],
  "bitbucket-server": ["token", "basic", "bearer", "none"],
  "azure-devops": ["basic", "bearer", "none"],
  gitea: ["token", "bearer", "none"],
  forgejo: ["token", "bearer", "none"],
};
const DEFAULT_BASE = {
  github: "https://github.com",
  gitlab: "https://gitlab.com",
  "bitbucket-cloud": "https://bitbucket.org",
};
const plain = (value) =>
  value !== null &&
  typeof value === "object" &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const cleanText = (value, max = 4096) =>
  String(value ?? "")
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .slice(0, max);
const segments = (value) => value.split("/").filter(Boolean);
const encoded = (value) => segments(value).map(encodeURIComponent).join("/");
function identifier(value) {
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(value) ||
    value === "prototype" ||
    Object.getOwnPropertyNames(Object.prototype).includes(value)
  )
    throw new Error("ID profilo hosting non valido.");
  return value;
}
function text(value, label, max = 4096) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw new Error(`${label} non valido.`);
  return value.trim();
}
function loopback(host) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(host.toLowerCase());
}
function endpoint(input) {
  let url;
  try {
    url = new URL(text(input, "URL server"));
  } catch {
    throw new Error("URL server hosting non valido.");
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && loopback(url.hostname)))
  )
    throw new Error(
      "Usa un URL HTTPS senza credenziali, query o frammenti; HTTP è ammesso soltanto su loopback.",
    );
  const decoded = decodeURIComponent(url.pathname);
  if (
    /[\x00-\x1f\x7f\\]/.test(decoded) ||
    segments(decoded).some((part) => part === "." || part === "..")
  )
    throw new Error("Percorso server hosting non valido.");
  return url.href.replace(/\/$/, "");
}
function knownHost(host) {
  if (["github.com", "ssh.github.com", "api.github.com"].includes(host))
    return { provider: "github", baseUrl: "https://github.com" };
  if (["gitlab.com", "altssh.gitlab.com"].includes(host))
    return { provider: "gitlab", baseUrl: "https://gitlab.com" };
  if (
    ["bitbucket.org", "altssh.bitbucket.org", "api.bitbucket.org"].includes(
      host,
    )
  )
    return { provider: "bitbucket-cloud", baseUrl: "https://bitbucket.org" };
  if (
    ["dev.azure.com", "ssh.dev.azure.com"].includes(host) ||
    /^[a-z0-9-]+\.visualstudio\.com$/.test(host)
  )
    return { provider: "azure-devops" };
  return null;
}
function hostAlias(host) {
  const known = knownHost(host);
  if (known?.provider === "github") return "github.com";
  if (known?.provider === "gitlab") return "gitlab.com";
  if (known?.provider === "bitbucket-cloud") return "bitbucket.org";
  if (["dev.azure.com", "ssh.dev.azure.com"].includes(host))
    return "dev.azure.com";
  return host;
}
function parseRemote(input) {
  if (
    typeof input !== "string" ||
    !input ||
    input.length > 16384 ||
    /[\x00-\x1f\x7f]/.test(input)
  )
    return null;
  if (/^[a-z][a-z\d+.-]*::/i.test(input)) return null;
  let host,
    port = "",
    repository,
    protocol,
    safeUrl;
  try {
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(input)) {
      const rawPath = input
        .slice(input.indexOf("://") + 3)
        .replace(/^[^/]*(?=\/|$)/, "")
        .split(/[?#]/)[0];
      if (
        segments(decodeURIComponent(rawPath)).some(
          (part) => part === "." || part === "..",
        )
      )
        return null;
      const url = new URL(input);
      if (!["https:", "http:", "ssh:", "git:"].includes(url.protocol))
        return null;
      host = url.hostname.toLowerCase();
      port = url.port;
      protocol = url.protocol.slice(0, -1);
      repository = decodeURIComponent(url.pathname)
        .replace(/^\/+|\/+$/g, "")
        .replace(/\.git$/, "");
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      safeUrl = url.href;
    } else {
      const match = /^(?:[^@/:]+@)?(\[[^\]]+\]|[^/:]+):(.+)$/.exec(input);
      if (!match || /^[a-zA-Z]:[\\/]/.test(input)) return null;
      host = match[1].toLowerCase();
      protocol = "ssh";
      repository = decodeURIComponent(match[2])
        .replace(/^\/+|\/+$/g, "")
        .replace(/\.git$/, "");
      safeUrl = `ssh://${host}/${encoded(repository)}.git`;
    }
    if (
      !repository ||
      /[\x00-\x1f\x7f\\?#]/.test(repository) ||
      segments(repository).some((part) => part === "." || part === "..") ||
      !host
    )
      return null;
    const known = knownHost(host);
    return {
      host,
      port,
      protocol,
      repository,
      url: safeUrl,
      provider: known?.provider || null,
      supported: !!known,
    };
  } catch {
    return null;
  }
}

class ProviderService {
  constructor({ file, vault, fetch = globalThis.fetch, exec = runFile }) {
    if (!file || !vault)
      throw new Error("Configurazione hosting e vault richiesti.");
    this.file = path.resolve(file);
    this.vault = vault;
    this.fetch = fetch;
    this.exec = exec;
    this.state = { profiles: [], bindings: [] };
    this.secrets = new Set();
    this.serial = Promise.resolve();
    this.ready = this.load();
  }
  remember(credentials) {
    for (const value of Object.values(credentials || {}))
      if (typeof value === "string" && value) {
        this.secrets.add(value);
        this.secrets.add(encodeURIComponent(value));
      }
  }
  redact(input) {
    let output = String(input ?? "");
    for (const secret of [...this.secrets].sort((a, b) => b.length - a.length))
      output = output.split(secret).join("[redacted]");
    return output
      .replace(/(https?:\/\/)[^\s/@]+@/gi, "$1[credentials]@")
      .replace(
        /([?&](?:token|key|password|access_token|private_token|sig)=)[^\s&]+/gi,
        "$1[redacted]",
      );
  }
  failure(error) {
    return new Error(
      cleanText(
        this.redact(error?.message || "Operazione hosting non riuscita."),
        1800,
      ),
    );
  }
  profile(input, prior = {}) {
    if (!plain(input)) throw new Error("Profilo hosting non valido.");
    const id = identifier(input.id || prior.id || randomUUID());
    const provider = input.provider || prior.provider;
    if (!Object.hasOwn(MODES, provider))
      throw new Error("Provider hosting non supportato.");
    const profile = {
      id,
      name: text(input.name ?? prior.name ?? provider, "Nome profilo", 160),
      provider,
    };
    profile.baseUrl = endpoint(
      input.baseUrl || prior.baseUrl || DEFAULT_BASE[provider],
    );
    profile.authMode = input.authMode || prior.authMode || MODES[provider][0];
    if (!MODES[provider].includes(profile.authMode))
      throw new Error(
        "Modalità di autenticazione non supportata dal provider.",
      );
    if (input.username !== undefined || prior.username !== undefined)
      profile.username =
        input.username === ""
          ? ""
          : text(input.username ?? prior.username, "Username", 320);
    if (
      provider === "bitbucket-cloud" &&
      !["bitbucket.org", "api.bitbucket.org"].includes(
        new URL(profile.baseUrl).hostname,
      )
    )
      throw new Error(
        "Bitbucket Cloud usa bitbucket.org; per server privati seleziona Bitbucket Server.",
      );
    if (provider === "azure-devops") {
      const apiVersion = input.apiVersion || prior.apiVersion || "7.1";
      if (
        typeof apiVersion !== "string" ||
        !/^\d+\.\d+(?:-preview\.\d+)?$/.test(apiVersion)
      )
        throw new Error("Versione API Azure DevOps non valida.");
      profile.apiVersion = apiVersion;
    }
    return profile;
  }
  credentialInput(input) {
    if (!plain(input)) throw new Error("Credenziali hosting non valide.");
    const clean = {};
    for (const [key, value] of Object.entries(input)) {
      if (
        !["apiKey", "bearerToken"].includes(key) ||
        typeof value !== "string" ||
        value.length > 65536 ||
        /[\x00-\x1f\x7f]/.test(value)
      )
        throw new Error("Campo credenziali hosting non valido.");
      if (value.trim()) clean[key] = value;
    }
    this.remember(clean);
    return clean;
  }
  async credentials(id) {
    const value = (await this.vault.get(id)) || {};
    if (!plain(value)) throw new Error("Credenziali hosting non leggibili.");
    this.remember(value);
    return value;
  }
  async credentialBackup(id, read = true) {
    const encrypted =
      typeof this.vault.snapshot === "function" &&
      typeof this.vault.restore === "function";
    const backup = {
      encrypted,
      snapshot: encrypted ? await this.vault.snapshot(id) : undefined,
    };
    if (
      encrypted &&
      backup.snapshot !== null &&
      typeof backup.snapshot !== "string"
    )
      throw new Error("Snapshot credenziali non valido.");
    if (read || !encrypted) {
      try {
        backup.credentials = await this.credentials(id);
      } catch (error) {
        // Explicit replacement can recover unsafe legacy Linux ciphertext,
        // retaining only its encrypted bytes for a failed profile write.
        if (error.code !== "SECURE_STORAGE_INSECURE" || !encrypted) throw error;
        backup.credentials = {};
      }
    }
    return backup;
  }
  async rollbackCredentials(id, backup, expected) {
    if (backup.encrypted)
      await this.vault.restore(id, backup.snapshot, expected);
    else if (Object.keys(backup.credentials).length)
      await this.vault.set(id, backup.credentials);
    else await this.vault.delete(id);
  }
  async load() {
    try {
      const data = JSON.parse(await fs.readFile(this.file, "utf8"));
      if (
        !plain(data) ||
        !Array.isArray(data.profiles) ||
        data.profiles.length > 100 ||
        !Array.isArray(data.bindings) ||
        data.bindings.length > 1000
      )
        throw new Error("invalid");
      const profiles = data.profiles.map((row) => this.profile(row));
      if (new Set(profiles.map((row) => row.id)).size !== profiles.length)
        throw new Error("invalid");
      const bindings = data.bindings.map((row) => {
        if (
          !plain(row) ||
          !path.isAbsolute(row.repo) ||
          row.repo.includes("\0")
        )
          throw new Error("invalid");
        return {
          repo: row.repo,
          remote: text(row.remote, "Remote", 256),
          profileId: row.profileId == null ? null : identifier(row.profileId),
        };
      });
      this.state = { profiles, bindings };
    } catch (error) {
      if (error.code !== "ENOENT")
        throw new Error(
          "Configurazione hosting non leggibile; correggi il file metadata senza rimuovere le credenziali.",
        );
    }
  }
  async persist(state) {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}`;
    try {
      await fs.writeFile(temporary, JSON.stringify(state, null, 2), {
        mode: 0o600,
      });
      await fs.rename(temporary, this.file);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
  async mutate(fn) {
    const task = this.serial
      .catch(() => {})
      .then(async () => {
        await this.ready;
        return fn();
      });
    this.serial = task;
    try {
      return await task;
    } catch (error) {
      throw this.failure(error);
    }
  }
  async settings() {
    await this.ready;
    const profiles = await Promise.all(
      this.state.profiles.map(async (profile) => ({
        ...profile,
        hasCredential:
          typeof this.vault.has === "function"
            ? !!(await this.vault.has(profile.id))
            : Object.keys(await this.credentials(profile.id)).length > 0,
      })),
    );
    return {
      profiles,
      bindings: this.state.bindings.map((row) => ({ ...row })),
    };
  }
  async save(input, credentials) {
    return this.mutate(async () => {
      const prior = this.state.profiles.find((row) => row.id === input?.id);
      const profile = this.profile(input, prior || {}),
        next = {
          ...this.state,
          profiles: this.state.profiles.filter((row) => row.id !== profile.id),
        };
      if (next.profiles.length >= 100)
        throw new Error("Limite di 100 profili hosting raggiunto.");
      next.profiles.push(profile);
      let backup, expected;
      if (credentials !== undefined) {
        const clean = this.credentialInput(credentials),
          replace = Object.keys(clean).length > 0,
          clear = Object.keys(credentials).length === 0;
        if (replace || clear) {
          backup = await this.credentialBackup(profile.id, replace);
          expected = replace
            ? await this.vault.set(profile.id, {
                ...backup.credentials,
                ...clean,
              })
            : await this.vault.delete(profile.id);
        }
      }
      try {
        await this.persist(next);
        this.state = next;
      } catch (error) {
        if (backup)
          await this.rollbackCredentials(profile.id, backup, expected);
        throw error;
      }
      return this.settings();
    });
  }
  async delete(id) {
    return this.mutate(async () => {
      identifier(id);
      const next = {
        profiles: this.state.profiles.filter((row) => row.id !== id),
        bindings: this.state.bindings.filter((row) => row.profileId !== id),
      };
      const backup = await this.credentialBackup(id, false),
        expected = await this.vault.delete(id);
      try {
        await this.persist(next);
        this.state = next;
      } catch (error) {
        await this.rollbackCredentials(id, backup, expected);
        throw error;
      }
      return this.settings();
    });
  }
  async remotes(repo) {
    const { stdout } = await this.exec("git", ["-C", repo, "remote"], {
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    });
    const names = stdout.split("\n").filter(Boolean).slice(0, 50);
    return Promise.all(
      names.map(async (name) => {
        if (name.startsWith("-") || /[\x00-\x1f\x7f]/.test(name))
          throw new Error("Nome remote Git non valido.");
        const { stdout: url } = await this.exec(
          "git",
          ["-C", repo, "remote", "get-url", "--", name],
          { timeout: 15000, maxBuffer: 32768 },
        );
        const raw = url.endsWith("\n") ? url.slice(0, -1) : url;
        return {
          name,
          ...(parseRemote(raw) || {
            url: "",
            host: "",
            repository: "",
            provider: null,
            supported: false,
          }),
        };
      }),
    );
  }
  async bind(repo, remote, profileId = null) {
    return this.mutate(async () => {
      const real = await fs.realpath(repo),
        names = await this.remotes(real);
      const selected = names.find(
        (row) => row.name === text(remote, "Remote", 256),
      );
      if (!selected) throw new Error("Seleziona un remote del repository.");
      if (profileId !== null) {
        identifier(profileId);
        const profile = this.state.profiles.find((row) => row.id === profileId);
        if (!profile) throw new Error("Profilo hosting non trovato.");
        this.describe(selected, profile);
      }
      const next = {
        ...this.state,
        bindings: this.state.bindings.filter(
          (row) => row.repo !== real || row.remote !== selected.name,
        ),
      };
      next.bindings.push({ repo: real, remote: selected.name, profileId });
      if (next.bindings.length > 1000)
        throw new Error("Limite collegamenti hosting raggiunto.");
      await this.persist(next);
      this.state = next;
      return this.settings();
    });
  }
  describe(remote, profile) {
    if (!remote.host || !remote.repository)
      throw new Error(
        "Questo remote è Git generico o locale; le API hosting richiedono un remote HTTPS o SSH con percorso repository.",
      );
    let baseUrl = profile?.baseUrl || knownHost(remote.host)?.baseUrl;
    const provider = profile?.provider || knownHost(remote.host)?.provider;
    if (!provider) return null;
    let repoPath = remote.repository;
    if (provider === "azure-devops") {
      const parts = segments(repoPath);
      if (
        remote.host === "ssh.dev.azure.com" &&
        parts[0] === "v3" &&
        parts.length === 4
      ) {
        baseUrl ||= `https://dev.azure.com/${encodeURIComponent(parts[1])}`;
        if (
          decodeURIComponent(new URL(baseUrl).pathname).replace(
            /^\/+|\/+$/g,
            "",
          ) !== parts[1]
        )
          throw new Error(
            "L'organizzazione Azure del profilo non corrisponde al remote SSH. Nessuna credenziale è stata inviata.",
          );
        repoPath = `${parts[2]}/${parts[3]}`;
      } else {
        const marker = parts.indexOf("_git");
        if (marker < 1 || marker !== parts.length - 2)
          throw new Error(
            "Remote Azure DevOps non riconosciuto: serve project/_git/repository o SSH v3/org/project/repository.",
          );
        if (!baseUrl) {
          const origin = `${remote.protocol === "http" ? "http" : "https"}://${remote.host}${remote.port ? ":" + remote.port : ""}`;
          baseUrl =
            origin +
            (marker > 1
              ? "/" +
                parts
                  .slice(0, marker - 1)
                  .map(encodeURIComponent)
                  .join("/")
              : "");
        }
        if (
          decodeURIComponent(new URL(baseUrl).pathname).replace(
            /^\/+|\/+$/g,
            "",
          ) !== parts.slice(0, marker - 1).join("/")
        )
          throw new Error(
            "L'organizzazione o collection Azure del profilo non corrisponde al remote. Nessuna credenziale è stata inviata.",
          );
        repoPath = `${parts[marker - 1]}/${parts[marker + 1]}`;
      }
    }
    baseUrl = endpoint(baseUrl);
    const base = new URL(baseUrl);
    if (hostAlias(base.hostname) !== hostAlias(remote.host))
      throw new Error(
        "Il profilo hosting appartiene a un host diverso dal remote selezionato. Nessuna credenziale è stata inviata.",
      );
    if (
      ["https", "http"].includes(remote.protocol) &&
      (base.port || (base.protocol === "https:" ? "443" : "80")) !==
        (remote.port || (remote.protocol === "https" ? "443" : "80"))
    )
      throw new Error(
        "La porta del profilo hosting non corrisponde al remote HTTPS.",
      );
    if (provider !== "azure-devops") {
      let prefix = decodeURIComponent(base.pathname)
        .replace(/^\/+|\/+$/g, "")
        .replace(/\/api\/v3$/, "");
      if (prefix === "api/v3") prefix = "";
      if (["https", "http"].includes(remote.protocol) && prefix) {
        if (!repoPath.startsWith(prefix + "/"))
          throw new Error(
            "Il remote non appartiene al prefisso del server configurato.",
          );
        repoPath = repoPath.slice(prefix.length + 1);
      }
      if (provider === "bitbucket-server")
        repoPath = repoPath.replace(/^scm\//, "");
    }
    const pieces = segments(repoPath);
    if (provider === "gitlab" ? pieces.length < 2 : pieces.length !== 2)
      throw new Error(
        "Percorso repository non valido per il provider configurato.",
      );
    let apiBase;
    if (provider === "github")
      apiBase =
        base.hostname === "github.com"
          ? "https://api.github.com"
          : base.hostname === "api.github.com" || baseUrl.endsWith("/api/v3")
            ? baseUrl
            : baseUrl + "/api/v3";
    else if (provider === "gitlab") apiBase = baseUrl + "/api/v4";
    else if (provider === "bitbucket-cloud")
      apiBase = "https://api.bitbucket.org/2.0";
    else if (provider === "bitbucket-server")
      apiBase = baseUrl + "/rest/api/latest";
    else if (["gitea", "forgejo"].includes(provider))
      apiBase = baseUrl + "/api/v1";
    else apiBase = baseUrl + "/" + encodeURIComponent(pieces[0]) + "/_apis";
    return {
      provider,
      baseUrl,
      apiBase,
      repoPath,
      parts: pieces,
      remote: remote.name,
      profileId: profile?.id || null,
      profile: profile || { provider, baseUrl, authMode: "none" },
      capabilities: {
        prs: true,
        issues: !["bitbucket-server", "bitbucket-cloud"].includes(provider),
        issueScope: provider === "azure-devops" ? "project" : "repository",
      },
    };
  }
  async context(repo, options = {}) {
    await this.ready;
    const real = await fs.realpath(repo),
      remotes = await this.remotes(real);
    const matches = this.state.bindings.filter((row) => row.repo === real);
    const chosen = options.remote ?? matches.at(-1)?.remote;
    const binding = matches.find((row) => row.remote === chosen);
    const selected = chosen
      ? remotes.find((row) => row.name === chosen)
      : remotes.length === 1
        ? remotes[0]
        : null;
    if (!selected)
      return {
        repo: real,
        remotes,
        context: null,
        message:
          remotes.length > 1
            ? "Seleziona esplicitamente il remote da usare nelle integrazioni hosting."
            : "Il repository non ha un remote hosting selezionato.",
      };
    const id =
      options.profileId ??
      (binding?.remote === selected.name ? binding.profileId : null);
    const profile = id
      ? this.state.profiles.find((row) => row.id === id)
      : null;
    if (id && !profile)
      throw new Error("Il profilo hosting collegato non esiste più.");
    const context = this.describe(selected, profile);
    return {
      repo: real,
      remotes,
      context,
      message: context
        ? ""
        : "Remote Git generico: configura un profilo del server e collegalo a questo remote per PR e issue.",
    };
  }
  async headers(context) {
    const profile = context.profile;
    const mode = profile.authMode;
    const headers = {
      Accept:
        context.provider === "github"
          ? "application/vnd.github+json"
          : "application/json",
    };
    if (context.provider === "github")
      headers["X-GitHub-Api-Version"] = "2022-11-28";
    if (mode === "gh") return { headers, gh: true };
    if (mode === "none") return { headers, gh: false };
    const credentials = context.profileId
      ? await this.credentials(context.profileId)
      : {};
    const token =
      mode === "bearer" ? credentials.bearerToken : credentials.apiKey;
    if (!token)
      throw new Error(
        "Configura le credenziali del profilo hosting prima di accedere alle API.",
      );
    if (mode === "basic") {
      if (context.provider === "bitbucket-cloud" && !profile.username)
        throw new Error(
          "Bitbucket Cloud richiede l'email del token API come username.",
        );
      const basic = Buffer.from(`${profile.username || ""}:${token}`).toString(
        "base64",
      );
      this.secrets.add(basic);
      headers.Authorization = `Basic ${basic}`;
    } else if (mode === "token" && context.provider === "gitlab")
      headers["PRIVATE-TOKEN"] = token;
    else
      headers.Authorization = `${mode === "token" && ["gitea", "forgejo"].includes(context.provider) ? "token" : "Bearer"} ${token}`;
    return { headers, gh: false };
  }
  resource(context) {
    const [owner, repo] = context.parts;
    if (context.provider === "gitlab")
      return `${context.apiBase}/projects/${encodeURIComponent(context.repoPath)}`;
    if (context.provider === "bitbucket-server")
      return `${context.apiBase}/projects/${encodeURIComponent(owner)}/repos/${encodeURIComponent(repo)}`;
    if (context.provider === "bitbucket-cloud")
      return `${context.apiBase}/repositories/${encoded(context.repoPath)}`;
    if (context.provider === "azure-devops")
      return `${context.apiBase}/git/repositories/${encodeURIComponent(repo)}?api-version=${context.profile.apiVersion || "7.1"}`;
    return `${context.apiBase}/repos/${encoded(context.repoPath)}`;
  }
  async request(url, headers, options = {}) {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await this.fetch(url, {
        ...options,
        headers: {
          ...headers,
          ...(options.body ? { "Content-Type": "application/json" } : {}),
        },
        redirect: "error",
        signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400)
        throw new Error(
          "Redirect hosting rifiutato: le credenziali non verranno inoltrate.",
        );
      const advertised = Number(response.headers?.get("content-length"));
      if (advertised > MAX_BODY)
        throw new Error("Risposta hosting troppo grande.");
      let body = "";
      if (response.body?.getReader) {
        const reader = response.body.getReader(),
          chunks = [];
        let size = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BODY) {
            await reader.cancel();
            throw new Error("Risposta hosting troppo grande.");
          }
          chunks.push(Buffer.from(value));
        }
        body = Buffer.concat(chunks).toString("utf8");
      } else {
        body = await response.text();
        if (Buffer.byteLength(body) > MAX_BODY)
          throw new Error("Risposta hosting troppo grande.");
      }
      let data;
      try {
        data = body ? JSON.parse(body) : null;
      } catch {
        throw new Error(
          `Risposta hosting JSON non valida (HTTP ${response.status}).`,
        );
      }
      if (!response.ok) {
        const reason =
          data?.message ||
          data?.error?.message ||
          data?.error ||
          data?.errors?.[0]?.message ||
          "Accesso al repository non riuscito";
        throw new Error(
          `Hosting HTTP ${response.status}: ${cleanText(this.redact(typeof reason === "string" ? reason : "Accesso negato"), 800)}`,
        );
      }
      return { data, headers: response.headers };
    } catch (error) {
      if (error.name === "AbortError")
        throw new Error("La richiesta hosting ha superato 15 secondi.");
      throw this.failure(error);
    } finally {
      clearTimeout(timer);
    }
  }
  async gh(context, endpointPath) {
    const host = new URL(context.baseUrl).hostname;
    if (
      new URL(context.baseUrl).port ||
      !["/", "/api/v3"].includes(new URL(context.baseUrl).pathname)
    )
      throw new Error(
        "Per GitHub Enterprise con porta o prefisso usa un profilo token invece di gh.",
      );
    try {
      const { stdout } = await this.exec(
        "gh",
        [
          "api",
          "--hostname",
          host === "api.github.com" ? "github.com" : host,
          endpointPath,
        ],
        { timeout: 30000, maxBuffer: MAX_BODY },
      );
      if (Buffer.byteLength(stdout) > MAX_BODY)
        throw new Error("Risposta gh troppo grande.");
      return JSON.parse(stdout);
    } catch (error) {
      if (error.code === "ENOENT")
        throw new Error(
          "GitHub CLI non installata: configura un token hosting oppure installa gh e accedi all'host selezionato.",
        );
      throw this.failure(new Error(error.stderr || error.message));
    }
  }
  async status(repo, options = {}) {
    let resolved;
    try {
      resolved = await this.context(repo, options);
      const { context, remotes, message } = resolved;
      if (!context)
        return {
          available: false,
          authenticated: false,
          message,
          remotes,
          capabilities: { prs: false, issues: false },
        };
      const auth = await this.headers(context);
      let metadata;
      try {
        metadata = auth.gh
          ? await this.gh(context, `repos/${encoded(context.repoPath)}`)
          : (await this.request(this.resource(context), auth.headers)).data;
      } catch (error) {
        if (
          !context.profileId &&
          context.provider === "github" &&
          /HTTP (401|403|404)/.test(error.message)
        ) {
          metadata = await this.gh(
            context,
            `repos/${encoded(context.repoPath)}`,
          );
          context.profile.authMode = "gh";
        } else throw error;
      }
      if (
        context.provider === "bitbucket-cloud" &&
        metadata?.has_issues === false
      )
        context.capabilities.issues = false;
      return {
        available: true,
        authenticated: true,
        provider: context.provider,
        host: new URL(context.baseUrl).host,
        remote: context.remote,
        repository: context.repoPath,
        profileId: context.profileId,
        capabilities: context.capabilities,
        remotes,
        message:
          (context.profile.authMode === "none"
            ? "Accesso pubblico verificato, senza invio di credenziali. "
            : context.profile.authMode === "gh"
              ? "Accesso GitHub CLI verificato sull'host selezionato. "
              : "Accesso al repository hosting verificato. ") +
          (context.provider === "azure-devops"
            ? "Le issue sono work item del progetto Azure DevOps, non del singolo repository."
            : !context.capabilities.issues
              ? "Questo server non espone issue native (usa il tracker collegato)."
              : "Le credenziali restano nel vault locale."),
      };
    } catch (error) {
      return {
        available: !!resolved?.context,
        authenticated: false,
        message: this.failure(error).message,
        remotes: resolved?.remotes || [],
        capabilities: resolved?.context?.capabilities || {
          prs: false,
          issues: false,
        },
        ...(resolved?.context
          ? {
              provider: resolved.context.provider,
              host: new URL(resolved.context.baseUrl).host,
              remote: resolved.context.remote,
              repository: resolved.context.repoPath,
              profileId: resolved.context.profileId,
            }
          : {}),
      };
    }
  }
  link(context, candidate, fallback) {
    try {
      if (
        typeof candidate !== "string" ||
        /[\x00-\x1f\x7f]/.test(candidate) ||
        this.redact(candidate) !== candidate
      )
        throw new Error();
      const url = new URL(candidate);
      const web = new URL(
        context.provider === "bitbucket-cloud"
          ? "https://bitbucket.org"
          : context.baseUrl,
      );
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.origin !== web.origin ||
        [...url.searchParams.keys()].some((key) =>
          /token|password|secret|key|sig/i.test(key),
        )
      )
        throw new Error();
      return url.href;
    } catch {
      return fallback;
    }
  }
  normalize(context, item, kind) {
    if (!plain(item)) return null;
    const provider = context.provider;
    if (kind === "issues" && item.pull_request) return null;
    const rawNumber = item.number ?? item.iid ?? item.pullRequestId ?? item.id;
    const number =
      typeof rawNumber === "string" && /^[\d]{1,16}$/.test(rawNumber)
        ? Number(rawNumber)
        : rawNumber;
    if (!Number.isSafeInteger(number) || number < 1) return null;
    const login =
      provider === "bitbucket-server"
        ? item.author?.user?.slug || item.author?.user?.displayName
        : item.author?.login ||
          item.author?.username ||
          item.author?.nickname ||
          item.author?.display_name ||
          item.user?.login ||
          item.createdBy?.uniqueName ||
          item.createdBy?.displayName;
    const web =
      context.provider === "bitbucket-cloud"
        ? "https://bitbucket.org"
        : context.baseUrl.replace(/\/api\/v3$/, "");
    let fallback = `${web}/${encoded(context.repoPath)}/${kind === "prs" ? (provider === "github" ? "pull" : "pulls") : "issues"}/${encodeURIComponent(number)}`;
    if (provider === "gitlab")
      fallback = `${web}/${encoded(context.repoPath)}/-/${kind === "prs" ? "merge_requests" : "issues"}/${encodeURIComponent(number)}`;
    if (provider === "bitbucket-cloud")
      fallback = `${web}/${encoded(context.repoPath)}/${kind === "prs" ? "pull-requests" : "issues"}/${encodeURIComponent(number)}`;
    if (provider === "bitbucket-server")
      fallback = `${web}/projects/${encodeURIComponent(context.parts[0])}/repos/${encodeURIComponent(context.parts[1])}/pull-requests/${encodeURIComponent(number)}/overview`;
    if (provider === "azure-devops")
      fallback =
        kind === "prs"
          ? `${web}/${encodeURIComponent(context.parts[0])}/_git/${encodeURIComponent(context.parts[1])}/pullrequest/${encodeURIComponent(number)}`
          : `${web}/${encodeURIComponent(context.parts[0])}/_workitems/edit/${encodeURIComponent(number)}`;
    if (this.redact(fallback) !== fallback) return null;
    const candidate =
      item.html_url ||
      item.web_url ||
      item.links?.html?.href ||
      item.links?.self?.[0]?.href ||
      item._links?.web?.href;
    const updated =
      item.updatedAt ||
      item.updated_at ||
      item.updated_on ||
      item.creationDate ||
      (typeof item.updatedDate === "number" && Number.isFinite(item.updatedDate)
        ? new Date(item.updatedDate).toISOString()
        : "");
    return {
      id: Number.isSafeInteger(item.id) && item.id > 0 ? item.id : number,
      number,
      title: cleanText(
        this.redact(item.title || item.fields?.["System.Title"] || ""),
        1000,
      ),
      state: cleanText(
        this.redact(
          item.state || item.status || item.fields?.["System.State"] || "open",
        ),
        60,
      ),
      author: {
        login: cleanText(
          this.redact(
            login || item.fields?.["System.AssignedTo"]?.displayName || "",
          ),
          320,
        ),
      },
      url: this.link(context, candidate, fallback),
      updatedAt: cleanText(this.redact(updated), 100),
      isDraft: !!(item.draft || item.isDraft || item.work_in_progress),
      headRefName: cleanText(
        this.redact(
          item.headRefName ||
            item.head?.ref ||
            item.source_branch ||
            item.source?.branch?.name ||
            item.fromRef?.displayId ||
            item.sourceRefName?.replace(/^refs\/heads\//, ""),
        ),
        512,
      ),
      baseRefName: cleanText(
        this.redact(
          item.baseRefName ||
            item.base?.ref ||
            item.target_branch ||
            item.destination?.branch?.name ||
            item.toRef?.displayId ||
            item.targetRefName?.replace(/^refs\/heads\//, ""),
        ),
        512,
      ),
      labels: Array.isArray(item.labels)
        ? item.labels.slice(0, 30).map((label) => ({
            name: cleanText(
              this.redact(typeof label === "string" ? label : label?.name),
              160,
            ),
          }))
        : [],
    };
  }
  async ghList(context, kind) {
    const output = [],
      seen = new Set();
    for (let page = 1; page <= MAX_PAGES && output.length < MAX_ITEMS; page++) {
      const data = await this.gh(
        context,
        `repos/${encoded(context.repoPath)}/${kind === "prs" ? "pulls" : "issues"}?state=open&per_page=100&page=${page}`,
      );
      if (!Array.isArray(data)) throw new Error("Elenco GitHub non valido.");
      for (const item of data) {
        const row = this.normalize(context, item, kind);
        if (row && !seen.has(String(row.id))) {
          seen.add(String(row.id));
          output.push(row);
        }
        if (output.length === MAX_ITEMS) break;
      }
      if (data.length < 100) break;
    }
    return output;
  }
  async list(repo, kind = "prs", options = {}) {
    if (!["prs", "issues"].includes(kind))
      throw new Error("Tipo elenco hosting non valido.");
    try {
      const { context, message } = await this.context(repo, options);
      if (!context) throw new Error(message);
      if (!context.capabilities[kind])
        throw new Error(
          "Il provider non espone issue native: usa il tracker collegato.",
        );
      const auth = await this.headers(context);
      if (auth.gh) return this.ghList(context, kind);
      if (context.provider === "azure-devops" && kind === "issues") {
        const version = context.profile.apiVersion || "7.1";
        const query = await this.request(
          `${context.apiBase}/wit/wiql?$top=50&api-version=${version}`,
          auth.headers,
          {
            method: "POST",
            body: JSON.stringify({
              query:
                "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.State] NOT IN ('Closed', 'Done', 'Removed') ORDER BY [System.ChangedDate] DESC",
            }),
          },
        );
        const ids = (query.data?.workItems || [])
          .slice(0, MAX_ITEMS)
          .map((item) => item.id)
          .filter((id) => Number.isSafeInteger(id) && id > 0);
        if (!ids.length) return [];
        const data = await this.request(
          `${context.apiBase}/wit/workitemsbatch?api-version=${version}`,
          auth.headers,
          {
            method: "POST",
            body: JSON.stringify({
              ids,
              fields: [
                "System.Id",
                "System.Title",
                "System.State",
                "System.AssignedTo",
                "System.ChangedDate",
              ],
              errorPolicy: "Omit",
            }),
          },
        );
        if (!Array.isArray(data.data?.value))
          throw new Error("Elenco work item Azure non valido.");
        return data.data.value
          .map((item) =>
            this.normalize(
              context,
              { ...item, updatedAt: item.fields?.["System.ChangedDate"] },
              kind,
            ),
          )
          .filter(Boolean)
          .slice(0, MAX_ITEMS);
      }
      let initial;
      const resource = this.resource(context).split("?")[0];
      if (context.provider === "github")
        initial = `${resource}/${kind === "prs" ? "pulls" : "issues"}?state=open&per_page=50`;
      else if (context.provider === "gitlab")
        initial = `${resource}/${kind === "prs" ? "merge_requests" : "issues"}?state=opened&scope=all&per_page=50&page=1`;
      else if (context.provider === "bitbucket-cloud")
        initial = `${resource}/${kind === "prs" ? "pullrequests?state=OPEN" : "issues?q=state!%3D%22closed%22%20AND%20state!%3D%22resolved%22"}&pagelen=50`;
      else if (context.provider === "bitbucket-server")
        initial = `${resource}/pull-requests?state=OPEN&limit=50&start=0`;
      else if (context.provider === "azure-devops")
        initial = `${resource}/pullrequests?searchCriteria.status=active&$top=50&api-version=${context.profile.apiVersion || "7.1"}`;
      else
        initial = `${resource}/${kind === "prs" ? "pulls" : "issues"}?state=open${kind === "issues" ? "&type=issues" : ""}&limit=50&page=1`;
      const output = [],
        seen = new Set(),
        pages = new Set();
      let next = initial;
      for (
        let page = 0;
        next && page < MAX_PAGES && output.length < MAX_ITEMS;
        page++
      ) {
        const url = new URL(next),
          origin = new URL(initial);
        if (
          url.origin !== origin.origin ||
          url.pathname !== origin.pathname ||
          url.username ||
          url.password ||
          url.hash
        )
          throw new Error(
            "Paginazione hosting verso un altro host o endpoint rifiutata; nessuna credenziale inoltrata.",
          );
        if (pages.has(url.href))
          throw new Error("Paginazione hosting ciclica rifiutata.");
        pages.add(url.href);
        let result;
        try {
          result = await this.request(url.href, auth.headers);
        } catch (error) {
          if (
            !context.profileId &&
            context.provider === "github" &&
            /HTTP (401|403|404)/.test(error.message)
          )
            return this.ghList(context, kind);
          throw error;
        }
        const rows = Array.isArray(result.data)
          ? result.data
          : result.data?.values || result.data?.value;
        if (!Array.isArray(rows)) throw new Error("Elenco hosting non valido.");
        for (const item of rows) {
          const normalized = this.normalize(context, item, kind);
          if (!normalized || seen.has(String(normalized.id))) continue;
          seen.add(String(normalized.id));
          output.push(normalized);
          if (output.length === MAX_ITEMS) break;
        }
        next = null;
        if (context.provider === "bitbucket-cloud")
          next = result.data?.next || null;
        else if (
          context.provider === "bitbucket-server" &&
          result.data?.isLastPage === false &&
          Number.isSafeInteger(result.data.nextPageStart) &&
          result.data.nextPageStart >= 0
        ) {
          const following = new URL(initial);
          following.searchParams.set(
            "start",
            String(result.data.nextPageStart),
          );
          next = following.href;
        } else if (context.provider === "gitlab") {
          const number = result.headers?.get("x-next-page");
          if (number && /^\d+$/.test(number)) {
            const following = new URL(initial);
            following.searchParams.set("page", number);
            next = following.href;
          }
        } else {
          const link = result.headers?.get("link") || "";
          next = /<([^>]+)>;\s*rel="next"/.exec(link)?.[1] || null;
        }
      }
      return output.slice(0, MAX_ITEMS);
    } catch (error) {
      throw this.failure(error);
    }
  }
}

module.exports = { ProviderService, parseRemote };
