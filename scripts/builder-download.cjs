/* Copyright (C) 2026 Davide Leopardi
 * SPDX-License-Identifier: GPL-3.0-only */

"use strict";

// Build-process preload only. Keep Electron's reviewed downloader and its
// checksum/cache implementation; translate electron-builder's legacy Got
// options at its transport boundary. Application fetch is never changed.
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const crypto = require("node:crypto");
const { EnvHttpProxyAgent } = require("undici");
const { HttpProxyAgent } = require("http-proxy-agent");
const { HttpsProxyAgent } = require("https-proxy-agent");
let active;

function unsupported() {
  const error = new Error("Unsupported build download transport option.");
  error.code = "BUILD_DOWNLOAD_UNSUPPORTED";
  return error;
}

function proxyEnvironment(env) {
  if (
    env.NODE_TLS_REJECT_UNAUTHORIZED === "0" ||
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0"
  )
    throw unsupported();
  const first = (...values) =>
    values.find((value) => typeof value === "string" && value.trim())?.trim() ||
    "";
  const values = {
    httpProxy: first(env.HTTP_PROXY, env.http_proxy),
    httpsProxy: first(env.HTTPS_PROXY, env.https_proxy),
    noProxy: first(env.NO_PROXY, env.no_proxy),
  };
  if (values.noProxy.length > 65536) throw unsupported();
  for (const proxy of [values.httpProxy, values.httpsProxy]) {
    if (!proxy) continue;
    let parsed;
    if (proxy.length > 4096) throw unsupported();
    try {
      parsed = new URL(proxy);
      decodeURIComponent(parsed.username);
      decodeURIComponent(parsed.password);
    } catch {
      throw unsupported();
    }
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      Boolean(parsed.username) !== Boolean(parsed.password)
    )
      throw unsupported();
  }
  return values;
}

function validateAgent(agent, proxies) {
  if (agent === undefined) return;
  if (
    !agent ||
    typeof agent !== "object" ||
    Object.keys(agent).some((key) => !["http", "https"].includes(key))
  )
    throw unsupported();
  for (const [protocol, Type] of [
    ["http", HttpProxyAgent],
    ["https", HttpsProxyAgent],
  ]) {
    const item = agent[protocol];
    if (item === undefined) continue;
    const proxy = proxies[`${protocol}Proxy`];
    if (
      !(item instanceof Type) ||
      item.constructor !== Type ||
      !proxy ||
      item.proxy?.href !== new URL(proxy).href
    )
      throw unsupported();
    // TLS overrides and custom connection behavior cannot be translated safely.
    if (
      item.connectOpts &&
      Object.keys(item.connectOpts).some(
        (key) =>
          !["host", "hostname", "port", "protocol", "ALPNProtocols"].includes(
            key,
          ),
      )
    )
      throw unsupported();
    if (
      item.connectOpts?.ALPNProtocols &&
      JSON.stringify(item.connectOpts.ALPNProtocols) !== '["http/1.1"]'
    )
      throw unsupported();
    if (
      item.proxyHeaders &&
      (typeof item.proxyHeaders !== "object" ||
        Object.keys(item.proxyHeaders).length)
    )
      throw unsupported();
    if (Object.hasOwn(item, "connect")) throw unsupported();
  }
}

function normalizeError(error, timedOut, aborted) {
  const status = error?.response?.status;
  let code = timedOut ? "ETIMEDOUT" : error?.code;
  for (
    let cause = error?.cause, depth = 0;
    !code && cause && depth < 5;
    cause = cause.cause, depth++
  )
    code = cause.code;
  if (!timedOut && (aborted || error?.name === "AbortError"))
    code = "ABORT_ERR";
  if (typeof code !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(code))
    code = undefined;
  const normalized = new Error(
    status
      ? `Build artifact request failed (HTTP ${status}).`
      : timedOut
        ? "Build artifact request timed out."
        : "Build artifact request failed.",
  );
  if (code) normalized.code = code;
  if (Number.isInteger(status))
    normalized.response = { status, statusCode: status };
  // Deliberately omit raw URLs, proxy credentials and arbitrary cause messages.
  return normalized;
}

function install({ env = process.env } = {}) {
  if (active) return active;
  const builderRequire = createRequire(
    require.resolve("app-builder-lib/package.json"),
  );
  const entry = builderRequire.resolve("@electron/get");
  const metadata = JSON.parse(
    fs.readFileSync(path.join(path.dirname(entry), "../package.json"), "utf8"),
  );
  if (metadata.version !== "5.1.0")
    throw new Error(
      "Build downloader requires the reviewed @electron/get 5.1.0.",
    );
  const transport = path.join(path.dirname(entry), "FetchDownloader.js");
  if (
    crypto
      .createHash("sha256")
      .update(fs.readFileSync(transport))
      .digest("hex") !==
    "38a0d3afe5dc45248283b0aa919c6c5ee49e658ee8cd3971747612682f87506b"
  )
    throw new Error(
      "Build downloader does not match the reviewed official transport.",
    );
  const { FetchDownloader } = require(transport);
  const original = FetchDownloader.prototype.download;
  const leases = new Map();
  let cleaning = false;

  async function release(key, failed) {
    const lease = leases.get(key);
    lease.failed ||= failed;
    if (--lease.users) return;
    leases.delete(key);
    if (lease.failed) await lease.dispatcher.destroy();
    else await lease.dispatcher.close();
  }

  async function download(url, target, options = {}) {
    if (cleaning) throw new Error("Build downloader is closing.");
    if (!options || typeof options !== "object") throw unsupported();
    const {
      agent,
      timeout = { request: 600000 },
      https,
      dispatcher,
      ...fetchOptions
    } = options;
    if (
      https !== undefined ||
      dispatcher !== undefined ||
      Object.keys(fetchOptions).some(
        (key) =>
          ![
            "quiet",
            "getProgressCallback",
            "headers",
            "signal",
            "redirect",
            "credentials",
            "referrer",
            "referrerPolicy",
            "integrity",
            "cache",
            "mode",
            "method",
          ].includes(key),
      )
    )
      throw unsupported();
    if (
      !timeout ||
      typeof timeout !== "object" ||
      Object.keys(timeout).some((key) => key !== "request") ||
      !Number.isSafeInteger(timeout.request) ||
      timeout.request < 1 ||
      timeout.request > 2147483647
    )
      throw unsupported();
    if (
      fetchOptions.signal !== undefined &&
      !(fetchOptions.signal instanceof AbortSignal)
    )
      throw unsupported();
    if (fetchOptions.method !== undefined && fetchOptions.method !== "GET")
      throw unsupported();
    const proxies = proxyEnvironment(env);
    validateAgent(agent, proxies);
    const key = JSON.stringify(proxies);
    let lease = leases.get(key);
    if (!lease) {
      lease = {
        dispatcher: new EnvHttpProxyAgent(proxies),
        users: 0,
        failed: false,
      };
      leases.set(key, lease);
    }
    lease.users++;
    const deadline = AbortSignal.timeout(timeout.request);
    const signal = fetchOptions.signal
      ? AbortSignal.any([fetchOptions.signal, deadline])
      : deadline;
    let failed = false;
    try {
      return await original.call(this, url, target, {
        ...fetchOptions,
        dispatcher: lease.dispatcher,
        signal,
      });
    } catch (error) {
      failed = true;
      throw normalizeError(
        error,
        deadline.aborted && signal.reason === deadline.reason,
        signal.aborted,
      );
    } finally {
      await release(key, failed);
    }
  }

  FetchDownloader.prototype.download = download;
  active = {
    async cleanup() {
      cleaning = true;
      if (FetchDownloader.prototype.download === download)
        FetchDownloader.prototype.download = original;
      const pending = [...leases.values()];
      // Called after downloads or when ending the owned build process. Destroy
      // outstanding sockets so cleanup also terminates stalled requests.
      await Promise.all(pending.map((lease) => lease.dispatcher.destroy()));
      if (active === this) active = undefined;
    },
    get openDispatchers() {
      return leases.size;
    },
  };
  return active;
}

module.exports = { install, cleanup: () => active?.cleanup() };
// Tests import without installation; --require installs inside only the CLI
// process, before electron-builder loads its overridden dependency.
if (
  process.execArgv.some(
    (arg, index, args) =>
      arg === "--require" && path.resolve(args[index + 1] || "") === __filename,
  )
) {
  // @electron/get otherwise initializes a global proxy dispatcher on import.
  // This owned CLI process routes every request using its isolated dispatcher.
  delete process.env.ELECTRON_GET_USE_PROXY;
  install();
}
