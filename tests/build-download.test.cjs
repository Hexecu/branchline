/* Copyright (C) 2026 Davide Leopardi
 * SPDX-License-Identifier: GPL-3.0-only */

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const net = require("node:net");
const crypto = require("node:crypto");
const { createRequire } = require("node:module");
const { spawn } = require("node:child_process");
const { HttpProxyAgent, HttpsProxyAgent } = {
  ...require("http-proxy-agent"),
  ...require("https-proxy-agent"),
};
const adapter = require("../scripts/builder-download.cjs");
const builderRequire = createRequire(
  require.resolve("app-builder-lib/package.json"),
);
const get = builderRequire("@electron/get");
const { FetchDownloader } = require(
  path.join(
    path.dirname(builderRequire.resolve("@electron/get")),
    "FetchDownloader.js",
  ),
);
const digest = (bytes) =>
  crypto.createHash("sha256").update(bytes).digest("hex");
const payload = Buffer.from("Synthetic verified build artifact\n");

async function fixture(t, handler) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "build-download-"));
  const server = http.createServer(
    handler ||
      ((req, res) => {
        res.writeHead(200, { "content-length": payload.length });
        res.end(payload);
      }),
  );
  const sockets = new Set();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await adapter.cleanup();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    server,
    sockets,
    url: `http://127.0.0.1:${server.address().port}`,
  };
}

function generic(f, name = "fixture.zip", extra = {}) {
  return {
    version: "44.5.1",
    isGeneric: true,
    artifactName: name,
    cacheRoot: path.join(f.root, "cache"),
    tempDirectory: f.root,
    checksums: { [name]: digest(payload) },
    mirrorOptions: { resolveAssetURL: async () => `${f.url}/${name}` },
    downloadOptions: { quiet: true },
    ...extra,
  };
}

test("build graph excludes the vulnerable cache chain and keeps official Electron transport", () => {
  const lock = require("../package-lock.json");
  for (const key of Object.keys(lock.packages))
    assert.doesNotMatch(
      key,
      /node_modules\/(?:got|cacheable-request|http-cache-semantics)$/,
    );
  assert.equal(get.downloadArtifact.name, "downloadArtifact");
  assert.equal(lock.packages["node_modules/@electron/get"].version, "5.1.0");
  assert.equal(lock.packages["node_modules/undici"].version, "7.30.0");
});

test("official artifact download verifies cold, warm and tampered caches and preserves progress", async (t) => {
  let requests = 0;
  const progress = [];
  const f = await fixture(t, (req, res) => {
    requests++;
    res.setHeader("content-length", payload.length);
    res.end(payload);
  });
  const session = adapter.install({ env: {} });
  const options = generic(f, "fixture.zip", {
    downloadOptions: {
      quiet: true,
      getProgressCallback: (value) => {
        progress.push(value);
      },
    },
  });
  const file = await get.downloadArtifact(options);
  assert.deepEqual(fs.readFileSync(file), payload);
  assert.equal(requests, 1);
  assert.ok(
    progress.some(
      (value) => value.percent === 1 && value.transferred === payload.length,
    ),
  );
  assert.equal(await get.downloadArtifact(options), file);
  assert.equal(
    requests,
    1,
    "warm cache requires no artifact download with supplied checksum",
  );
  fs.writeFileSync(file, "tampered synthetic bytes");
  assert.deepEqual(
    fs.readFileSync(await get.downloadArtifact(options)),
    payload,
  );
  assert.equal(
    requests,
    2,
    "tampered cache is replaced using verified network bytes",
  );
  const bypassed = await get.downloadArtifact({
    ...options,
    cacheMode: get.ElectronDownloadCacheMode.Bypass,
  });
  assert.equal(requests, 3);
  assert.notEqual(bypassed, file);
  assert.deepEqual(
    fs.readFileSync(file),
    payload,
    "bypass does not mutate the verified shared artifact cache",
  );
  assert.equal(session.openDispatchers, 0);
});

test("checksum mismatch never publishes an unverified artifact to cache", async (t) => {
  const f = await fixture(t);
  const session = adapter.install({ env: {} });
  await assert.rejects(
    get.downloadArtifact(
      generic(f, "bad.zip", { checksums: { "bad.zip": "0".repeat(64) } }),
    ),
    /checksum|mismatch/i,
  );
  const files = fs.existsSync(path.join(f.root, "cache"))
    ? fs.readdirSync(path.join(f.root, "cache"), { recursive: true })
    : [];
  assert.equal(
    files.some((file) => file.endsWith("bad.zip")),
    false,
  );
  assert.equal(session.openDispatchers, 0);
});

test("actual builder mirror downloads fresh checksums, reuses cache and retries HTTP 503", async (t) => {
  let artifacts = 0,
    checksums = 0;
  const name = `electron-v44.5.1-${process.platform}-${process.arch}.zip`;
  const f = await fixture(t, (req, res) => {
    if (req.url.endsWith("SHASUMS256.txt")) {
      checksums++;
      res.end(`${digest(payload)} *${name}\n`);
      return;
    }
    artifacts++;
    if (artifacts === 1) {
      res.writeHead(503);
      res.end("synthetic retry");
      return;
    }
    res.end(payload);
  });
  const previous = {};
  for (const key of [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "http_proxy",
    "https_proxy",
    "ELECTRON_MIRROR",
    "ELECTRON_BUILDER_CACHE",
    "ELECTRON_DOWNLOAD_CACHE_MODE",
  ]) {
    previous[key] = process.env[key];
    delete process.env[key];
  }
  process.env.ELECTRON_BUILDER_CACHE = path.join(f.root, "builder-cache");
  t.after(() => {
    for (const [key, value] of Object.entries(previous))
      value === undefined
        ? delete process.env[key]
        : (process.env[key] = value);
  });
  const session = adapter.install({ env: {} });
  const builder = require("app-builder-lib/out/util/electronGet");
  const options = {
    version: "44.5.1",
    artifactName: "electron",
    platformName: process.platform,
    arch: process.arch,
    electronDownload: { mirror: `${f.url}/`, customDir: "fixture" },
  };
  const file = await builder.downloadElectronArtifactZip(options);
  assert.deepEqual(fs.readFileSync(file), payload);
  assert.equal(artifacts, 2);
  assert.equal(checksums, 1);
  assert.equal(await builder.downloadElectronArtifactZip(options), file);
  assert.equal(artifacts, 2);
  assert.equal(
    checksums,
    2,
    "cached archive is validated against fresh mirror checksum",
  );
  fs.writeFileSync(file, "tampered cache");
  await builder.downloadElectronArtifactZip(options);
  assert.equal(artifacts, 3);
  assert.equal(checksums, 4);
  assert.equal(session.openDispatchers, 0);
});

test("deadline covers stalled headers and stalled response bodies; caller cancellation is retained", async (t) => {
  const f = await fixture(t, (req, res) => {
    if (req.url === "/body") {
      res.writeHead(200, { "content-length": 100 });
      res.write("partial");
    }
  });
  const session = adapter.install({ env: {} });
  for (const route of ["/headers", "/body"]) {
    const started = Date.now();
    await assert.rejects(
      new FetchDownloader().download(
        `${f.url}${route}`,
        path.join(f.root, route.slice(1)),
        { quiet: true, timeout: { request: 70 } },
      ),
      { code: "ETIMEDOUT" },
    );
    assert.ok(Date.now() - started < 3000);
    for (let attempt = 0; f.sockets.size && attempt < 20; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(
      f.sockets.size,
      0,
      "timeout closes actual origin sockets before fixture cleanup",
    );
  }
  const caller = new AbortController();
  const downloading = new FetchDownloader().download(
    `${f.url}/headers`,
    path.join(f.root, "cancelled"),
    { quiet: true, timeout: { request: 1000 }, signal: caller.signal },
  );
  setTimeout(
    () =>
      caller.abort(
        new Error("synthetic caller cancellation with private detail"),
      ),
    30,
  );
  await assert.rejects(downloading, (error) => {
    assert.equal(error.code, "ABORT_ERR");
    assert.doesNotMatch(error.message, /private detail/);
    return true;
  });
  assert.equal(session.openDispatchers, 0);
});

test("builder retry receives HTTP status and nested network codes without exposing URLs", async (t) => {
  const secret = "synthetic-query-credential";
  const f = await fixture(t, (req, res) => {
    res.writeHead(503);
    res.write("unconsumed endless error body");
  });
  const session = adapter.install({ env: {} });
  await assert.rejects(
    new FetchDownloader().download(
      `${f.url}/?secret=${secret}`,
      path.join(f.root, "error"),
      { quiet: true, timeout: { request: 500 } },
    ),
    (error) => {
      assert.equal(error.response.statusCode, 503);
      assert.equal(error.message.includes(secret), false);
      assert.equal(error.cause, undefined);
      return true;
    },
  );
  const closed = net.createServer();
  await new Promise((resolve) => closed.listen(0, "127.0.0.1", resolve));
  const port = closed.address().port;
  await new Promise((resolve) => closed.close(resolve));
  await assert.rejects(
    new FetchDownloader().download(
      `http://127.0.0.1:${port}/`,
      path.join(f.root, "network"),
      { quiet: true },
    ),
    { code: "ECONNREFUSED" },
  );
  assert.equal(session.openDispatchers, 0);
});

test("authenticated proxy agents route requests, honor NO_PROXY and preserve concurrent downloads", async (t) => {
  const originHeaders = [],
    proxyHeaders = [];
  const f = await fixture(t, (req, res) => {
    originHeaders.push(req.headers);
    res.end(payload);
  });
  let tunnels = 0;
  const sockets = new Set();
  const proxy = http.createServer();
  proxy.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  proxy.on("connect", (req, socket, head) => {
    tunnels++;
    proxyHeaders.push(req.headers);
    const destination = new URL(`http://${req.url}`);
    const upstream = net.connect(
      Number(destination.port),
      destination.hostname,
      () => {
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        socket.pipe(upstream);
        upstream.pipe(socket);
      },
    );
    upstream.on("error", () => socket.destroy());
    socket.on("close", () => upstream.destroy());
  });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => proxy.close(resolve));
  });
  const proxyUrl = `http://fixture-user:fixture-pass@127.0.0.1:${proxy.address().port}`;
  const env = { HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, NO_PROXY: "" };
  const session = adapter.install({ env });
  const options = {
    quiet: true,
    agent: {
      http: new HttpProxyAgent(proxyUrl),
      https: new HttpsProxyAgent(proxyUrl),
    },
  };
  await Promise.all(
    [1, 2].map((index) =>
      new FetchDownloader().download(
        f.url,
        path.join(f.root, `proxy-${index}`),
        options,
      ),
    ),
  );
  assert.ok(tunnels >= 1);
  const auth = `Basic ${Buffer.from("fixture-user:fixture-pass").toString("base64")}`;
  assert.ok(
    proxyHeaders.every((headers) => headers["proxy-authorization"] === auth),
  );
  assert.ok(
    originHeaders.every(
      (headers) => headers["proxy-authorization"] === undefined,
    ),
  );
  assert.equal(session.openDispatchers, 0);
  const prior = tunnels;
  env.NO_PROXY = " 127.0.0.1 ";
  await new FetchDownloader().download(
    f.url,
    path.join(f.root, "bypass"),
    options,
  );
  assert.equal(tunnels, prior);
  env.NO_PROXY = " * ";
  await new FetchDownloader().download(
    f.url,
    path.join(f.root, "wildcard-bypass"),
    options,
  );
  assert.equal(tunnels, prior);
});

test("redirect keeps same-origin credentials but strips cross-origin authorization and cookies", async (t) => {
  let headers;
  const target = await fixture(t, (req, res) => {
    headers = req.headers;
    res.end(payload);
  });
  let sameOriginHeaders;
  const source = await fixture(t, (req, res) => {
    if (req.url === "/same") {
      sameOriginHeaders = req.headers;
      res.end(payload);
    } else {
      res.writeHead(302, {
        location: req.url === "/local" ? "/same" : `${target.url}/redirected`,
      });
      res.end();
    }
  });
  adapter.install({ env: {} });
  await new FetchDownloader().download(
    source.url,
    path.join(source.root, "redirect"),
    {
      quiet: true,
      headers: {
        authorization: "Bearer synthetic-authorization",
        cookie: "synthetic-session=user-a",
        "proxy-authorization": "Basic synthetic-private-proxy",
      },
    },
  );
  assert.equal(headers.authorization, undefined);
  assert.equal(headers.cookie, undefined);
  assert.equal(headers["proxy-authorization"], undefined);
  await new FetchDownloader().download(
    `${source.url}/local`,
    path.join(source.root, "same"),
    {
      quiet: true,
      headers: {
        authorization: "Bearer synthetic-authorization",
        cookie: "synthetic-session=user-a",
      },
    },
  );
  assert.equal(
    sameOriginHeaders.authorization,
    "Bearer synthetic-authorization",
  );
  assert.equal(sameOriginHeaders.cookie, "synthetic-session=user-a");
});

test("max-stale cannot replay another user's response or Set-Cookie through a build HTTP cache", async (t) => {
  let requests = 0;
  const f = await fixture(t, (req, res) => {
    requests++;
    const user =
      req.headers.authorization === "Bearer synthetic-user-a" ? "a" : "b";
    res.setHeader("cache-control", "max-age=0");
    res.setHeader("set-cookie", `synthetic-session=${user}`);
    res.end(`synthetic-private-${user}`);
  });
  const session = adapter.install({ env: {} });
  for (const user of ["a", "b"]) {
    const file = path.join(f.root, user);
    await new FetchDownloader().download(f.url, file, {
      quiet: true,
      headers: {
        authorization: `Bearer synthetic-user-${user}`,
        "cache-control": "max-stale=999999",
      },
    });
    assert.equal(fs.readFileSync(file, "utf8"), `synthetic-private-${user}`);
  }
  assert.equal(requests, 2);
  assert.equal(session.openDispatchers, 0);
});

test("unsupported TLS or custom agent options fail closed before any request", async (t) => {
  let requests = 0;
  const f = await fixture(t, (req, res) => {
    requests++;
    res.end(payload);
  });
  let session = adapter.install({ env: {} });
  for (const options of [
    { https: { rejectUnauthorized: false } },
    { agent: new http.Agent() },
    { agent: { http: new HttpProxyAgent("http://127.0.0.1:9999") } },
    { timeout: { request: 0 } },
    { timeout: { response: 10 } },
    { retry: 4 },
    { dispatcher: {} },
    { signal: {} },
  ])
    await assert.rejects(
      new FetchDownloader().download(
        f.url,
        path.join(f.root, "unsupported"),
        options,
      ),
      { code: "BUILD_DOWNLOAD_UNSUPPORTED" },
    );
  for (const env of [
    { HTTP_PROXY: "invalid" },
    { HTTPS_PROXY: "http://user@localhost:9999" },
    { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
  ]) {
    await session.cleanup();
    session = adapter.install({ env });
    await assert.rejects(
      new FetchDownloader().download(
        f.url,
        path.join(f.root, "unsupported"),
        {},
      ),
      { code: "BUILD_DOWNLOAD_UNSUPPORTED" },
    );
  }
  assert.equal(requests, 0);
  assert.equal(session.openDispatchers, 0);
});

test("owned CLI preload removes the global proxy flag without changing global fetch or global dispatcher", async (t) => {
  await adapter.cleanup();
  const f = await fixture(t);
  const baseline = path.join(f.root, "baseline.cjs");
  const undici = JSON.stringify(require.resolve("undici"));
  fs.writeFileSync(
    baseline,
    `global.__buildFetch=global.fetch;global.__buildDispatcher=require(${undici}).getGlobalDispatcher();`,
  );
  const child = spawn(
    process.execPath,
    [
      "--require",
      baseline,
      "--require",
      path.resolve(__dirname, "../scripts/builder-download.cjs"),
      "-e",
      `require('@electron/get');if(process.env.ELECTRON_GET_USE_PROXY!==undefined||global.fetch!==global.__buildFetch||require(${undici}).getGlobalDispatcher()!==global.__buildDispatcher)process.exit(1);`,
    ],
    {
      env: { ...process.env, ELECTRON_GET_USE_PROXY: "true" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stderr.on("data", (chunk) => (output += chunk));
  const status = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  assert.equal(status, 0, output);
});
