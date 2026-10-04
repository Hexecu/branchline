/* Copyright (C) 2026 Davide Leopardi
 * SPDX-License-Identifier: GPL-3.0-only */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { ProviderService, parseRemote } = require("../electron/providers.cjs");

// All credentials, hosts and responses are synthetic; no process environment or
// real Git/hosting account is consulted by this injected transport fixture.
const secret = "SYNTHETIC_HOSTING_CREDENTIAL_FOR_TESTS";
async function fixture(t, fetch = async () => new Response("{}")) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "branchline-hosting-security-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const saved = new Map();
  const service = new ProviderService({
    file: path.join(directory, "profiles.json"),
    vault: {
      get: (id) => saved.get(id) || null,
      has: (id) => saved.has(id),
      set: (id, value) => saved.set(id, { ...value }),
      delete: (id) => saved.delete(id),
    },
    exec: async (_file, args) => ({
      stdout: args.includes("get-url")
        ? "git@github.com:qa/project.git\n"
        : "origin\n",
      stderr: "",
    }),
    fetch,
  });
  const profile = {
    id: "qa-profile",
    name: "Synthetic profile",
    provider: "github",
    baseUrl: "https://github.com",
    authMode: "token",
  };
  await service.save(profile, { apiKey: secret });
  const context = service.describe(
    parseRemote("git@github.com:qa/project.git"),
    profile,
  );
  return { directory, service, context };
}

test("hosting reads expose presence flags and redact known credentials throughout normalized result fields", async (t) => {
  const { directory, service, context } = await fixture(t);
  const metadata = await service.settings();
  assert.equal(metadata.profiles[0].hasCredential, true);
  assert(!JSON.stringify(metadata).includes(secret));
  assert(
    !(
      await fs.readFile(path.join(directory, "profiles.json"), "utf8")
    ).includes(secret),
  );
  const item = service.normalize(
    context,
    {
      id: 42,
      number: 42,
      title: `title ${secret}`,
      state: secret,
      author: { login: secret },
      updated_at: secret,
      head: { ref: secret },
      base: { ref: secret },
      labels: [{ name: secret }],
      html_url: `https://github.com/qa/project/pull/42/${secret}`,
    },
    "prs",
  );
  assert(item);
  assert(
    !JSON.stringify(item).includes(secret),
    "a known credential must not be returned in any result field or link",
  );
  assert.equal(
    service.normalize(
      context,
      { id: secret, number: secret, title: "malformed ID" },
      "prs",
    ),
    null,
  );
  assert.equal(
    service.normalize(
      context,
      { id: Number.MAX_SAFE_INTEGER + 1, title: "unsafe numeric ID" },
      "prs",
    ),
    null,
  );
});

test("hosting links reject unsafe schemes, userinfo, off-host targets and credential query parameters", async (t) => {
  const { service, context } = await fixture(t);
  const fallback = "https://github.com/qa/project/pull/42";
  for (const candidate of [
    "javascript:alert(1)",
    "file:///tmp/private",
    "http://github.com/qa/project/pull/42",
    "https://user:password@github.com/qa/project/pull/42",
    "https://other.example.invalid/pull/42",
    "https://github.com/qa/project/pull/42?access_token=synthetic",
    "https://github.com/qa/project/pull/42\n",
  ]) {
    assert.equal(
      service.normalize(
        context,
        { id: 42, number: 42, title: "safe", html_url: candidate },
        "prs",
      ).url,
      fallback,
    );
  }
  assert.equal(
    service.normalize(
      context,
      { id: 42, number: 42, title: "safe", html_url: fallback },
      "prs",
    ).url,
    fallback,
  );
});

test("hosting transport refuses redirects, bounds response bodies and sanitizes error echoes", async (t) => {
  const { service } = await fixture(t);
  service.fetch = async () =>
    new Response("{}", {
      status: 302,
      headers: { location: "https://other.example.invalid" },
    });
  await assert.rejects(
    service.request("https://github.com/api", {
      Authorization: `Bearer ${secret}`,
    }),
    /Redirect hosting rifiutato/,
  );
  service.fetch = async () =>
    new Response("{}", {
      headers: { "content-length": String(3 * 1024 * 1024 + 1) },
    });
  await assert.rejects(
    service.request("https://github.com/api", {}),
    /troppo grande/,
  );
  service.fetch = async () => new Response("x".repeat(3 * 1024 * 1024 + 1));
  await assert.rejects(
    service.request("https://github.com/api", {}),
    /troppo grande/,
  );
  service.fetch = async () =>
    new Response(JSON.stringify({ message: `credential echo ${secret}` }), {
      status: 403,
    });
  await assert.rejects(
    service.request("https://github.com/api", {}),
    (error) => {
      assert.match(error.message, /HTTP 403/);
      assert(!error.message.includes(secret));
      return true;
    },
  );
});

test("hosting pagination refuses foreign origins and changed endpoints before forwarding authentication", async (t) => {
  for (const next of [
    "https://other.example.invalid/collect",
    "https://api.github.com/user",
  ]) {
    const requests = [];
    const { directory, service } = await fixture(t, async (url, options) => {
      requests.push({ url, authorization: options.headers.Authorization });
      return new Response(
        JSON.stringify([
          {
            id: 42,
            number: 42,
            title: "safe",
            html_url: "https://github.com/qa/project/pull/42",
          },
        ]),
        {
          headers: { Link: `<${next}>; rel="next"` },
        },
      );
    });
    await assert.rejects(
      service.list(directory, "prs", {
        remote: "origin",
        profileId: "qa-profile",
      }),
      /Paginazione hosting/,
    );
    assert.equal(requests.length, 1);
    assert.equal(
      requests[0].url,
      "https://api.github.com/repos/qa/project/pulls?state=open&per_page=50",
    );
    assert.equal(requests[0].authorization, `Bearer ${secret}`);
  }
});
