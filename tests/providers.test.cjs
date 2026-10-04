/* Copyright (C) 2026 Davide Leopardi
 * SPDX-License-Identifier: GPL-3.0-only */

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { ProviderService, parseRemote } = require("../electron/providers.cjs");

const response = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
async function fixture(
  t,
  { remotes = { origin: "git@github.com:team/repo.git" }, fetch, gh } = {},
) {
  const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "branchline-providers-"),
    ),
    repo = path.join(directory, "repo");
  await fs.mkdir(repo);
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "hosting.json"),
    stored = new Map(),
    requests = [],
    commands = [];
  let decryptions = 0;
  const vault = {
    has: async (id) => stored.has(id),
    get: async (id) => {
      decryptions++;
      return stored.get(id) || null;
    },
    set: async (id, value) => stored.set(id, structuredClone(value)),
    delete: async (id) => stored.delete(id),
  };
  const exec = async (command, args, options) => {
    commands.push({ command, args, options });
    if (command === "git") {
      if (args[2] === "remote" && args.length === 3)
        return { stdout: Object.keys(remotes).join("\n") + "\n" };
      if (args[3] === "get-url") return { stdout: remotes[args[5]] + "\n" };
    }
    if (command === "gh" && gh)
      return { stdout: JSON.stringify(await gh(args, options)) };
    throw new Error("Unexpected CLI request in mocked hosting test.");
  };
  const transport = async (url, options) => {
    const request = {
      url: String(url),
      ...options,
      body: options.body ? JSON.parse(options.body) : null,
    };
    requests.push(request);
    if (!fetch)
      throw new Error("Unexpected network request in mocked hosting test.");
    return fetch(request);
  };
  const service = new ProviderService({ file, vault, fetch: transport, exec });
  await service.settings();
  return {
    service,
    file,
    repo,
    remotes,
    stored,
    requests,
    commands,
    vault,
    exec,
    transport,
    get decryptions() {
      return decryptions;
    },
  };
}
async function profile(
  f,
  provider,
  baseUrl,
  authMode = "token",
  credentials = { apiKey: "synthetic-token" },
  id = provider,
) {
  await f.service.save(
    {
      id,
      name: provider,
      provider,
      baseUrl,
      authMode,
      username: "qa@example.invalid",
    },
    credentials,
  );
  await f.service.bind(f.repo, "origin", id);
}

test("remote parsing supports nested HTTPS, SCP, SSH ports, Azure v3 and never returns embedded URL credentials", () => {
  const cases = [
    [
      "https://gitlab.com/group/nested/project.git",
      "gitlab.com",
      "group/nested/project",
      "gitlab",
      "",
    ],
    ["git@github.com:owner/repo.git", "github.com", "owner/repo", "github", ""],
    [
      "ssh://git@git.internal.example:2222/group/sub/repo.git",
      "git.internal.example",
      "group/sub/repo",
      null,
      "2222",
    ],
    [
      "git@ssh.dev.azure.com:v3/org/project/repo",
      "ssh.dev.azure.com",
      "v3/org/project/repo",
      "azure-devops",
      "",
    ],
    [
      "https://dev.azure.com/org/Project%20Name/_git/Repo%20Name",
      "dev.azure.com",
      "org/Project Name/_git/Repo Name",
      "azure-devops",
      "",
    ],
    ["ssh://git@[::1]:2222/team/repo.git", "[::1]", "team/repo", null, "2222"],
  ];
  for (const [url, host, repository, provider, port] of cases) {
    const actual = parseRemote(url);
    assert.equal(actual.host, host);
    assert.equal(actual.repository, repository);
    assert.equal(actual.provider, provider);
    assert.equal(actual.port, port);
  }
  const privateRemote = parseRemote(
    "https://username:synthetic-private-token@github.com/owner/repo.git?access_token=other-private-value#fragment",
  );
  assert(!JSON.stringify(privateRemote).includes("synthetic-private-token"));
  assert(!JSON.stringify(privateRemote).includes("other-private-value"));
  for (const input of [
    "/local/repo",
    "file:///local/repo",
    "ext::custom command",
    "https://gitlab.com/a/%00b",
    "https://host/a/%2e%2e/repo",
    "git@host:a/../repo",
    "bad\nurl",
  ])
    assert.equal(parseRemote(input), null);
});

test("profile metadata and credentials persist separately, partial updates preserve tokens and removal clears only that profile", async (t) => {
  const f = await fixture(t);
  await f.service.save(
    {
      id: "first",
      name: "First",
      provider: "github",
      baseUrl: "https://github.com",
      apiKey: "do-not-copy",
      arbitrarySecret: "do-not-copy",
    },
    { apiKey: "first-private-value", bearerToken: "first-bearer-value" },
  );
  await f.service.save(
    { id: "second", name: "Second", provider: "gitlab" },
    { apiKey: "second-private-value" },
  );
  const before = f.decryptions,
    settings = await f.service.settings();
  assert.equal(f.decryptions, before);
  assert(settings.profiles.every((row) => row.hasCredential));
  const saved = await fs.readFile(f.file, "utf8");
  for (const secret of [
    "do-not-copy",
    "first-private-value",
    "first-bearer-value",
    "second-private-value",
  ])
    assert(!saved.includes(secret));
  await f.service.save(
    { id: "first", name: "First renamed", provider: "github" },
    { apiKey: "", bearerToken: "replacement-bearer" },
  );
  assert.equal(f.stored.get("first").apiKey, "first-private-value");
  assert.equal(f.stored.get("first").bearerToken, "replacement-bearer");
  await f.service.save({ id: "first", name: "First", provider: "github" }, {});
  assert.equal(f.stored.has("first"), false);
  await f.service.delete("first");
  assert.equal(f.stored.get("second").apiKey, "second-private-value");
  const reloaded = new ProviderService({
    file: f.file,
    vault: f.vault,
    fetch: f.transport,
    exec: f.exec,
  });
  assert.equal((await reloaded.settings()).profiles[0].id, "second");
  await assert.rejects(
    f.service.save({ id: "__proto__", provider: "github", name: "bad" }),
    /ID/,
  );
  await assert.rejects(f.service.save(new Date()), /Profilo/);
  await assert.rejects(
    f.service.save({
      id: "bad",
      provider: "github",
      name: "bad",
      baseUrl: "https://name:secret@example.invalid",
    }),
    /senza credenziali/,
  );
  await assert.rejects(
    f.service.save({
      id: "bad",
      provider: "github",
      name: "bad",
      baseUrl: "http://remote.example.invalid",
    }),
    /HTTPS/,
  );
});

test("generic remotes are handled gracefully without gh or hosting HTTP requests", async (t) => {
  const f = await fixture(t, {
    remotes: { origin: "ssh://git@generic.example:2222/deep/team/repo.git" },
  });
  const status = await f.service.status(f.repo);
  assert.equal(status.available, false);
  assert.equal(status.authenticated, false);
  assert.match(status.message, /Git generico/);
  assert.equal(f.requests.length, 0);
  assert(!f.commands.some((row) => row.command === "gh"));
  await assert.rejects(f.service.list(f.repo), /Git generico/);
});

test("multiple remotes require a selection and keep independent credentials/bindings for origin and upstream", async (t) => {
  const f = await fixture(t, {
    remotes: {
      origin: "git@github.com:own/repo.git",
      upstream: "https://gitlab.com/group/sub/repo.git",
    },
    fetch: (call) =>
      response(
        call.url.includes("gitlab.com")
          ? { id: 1, name: "repo" }
          : { id: 2, full_name: "own/repo" },
      ),
  });
  assert.equal((await f.service.status(f.repo)).available, false);
  assert.equal(f.requests.length, 0);
  await f.service.save(
    { id: "gh", name: "GH", provider: "github" },
    { apiKey: "gh-isolated-token" },
  );
  await f.service.save(
    { id: "gl", name: "GL", provider: "gitlab" },
    { apiKey: "gl-isolated-token" },
  );
  await f.service.bind(f.repo, "origin", "gh");
  await f.service.bind(f.repo, "upstream", "gl");
  assert.equal((await f.service.settings()).bindings.length, 2);
  const status = await f.service.status(f.repo);
  assert.equal(status.remote, "upstream");
  assert.equal(status.provider, "gitlab");
  assert.equal(f.requests.at(-1).headers["PRIVATE-TOKEN"], "gl-isolated-token");
  await f.service.status(f.repo, { remote: "origin" });
  assert.equal(
    f.requests.at(-1).headers.Authorization,
    "Bearer gh-isolated-token",
  );
  await assert.rejects(
    f.service.bind(f.repo, "upstream", "gh"),
    /host diverso/,
  );
  await f.service.delete("gh");
  assert.equal((await f.service.settings()).bindings[0].remote, "upstream");
  assert.equal(f.stored.get("gl").apiKey, "gl-isolated-token");
});

test("public GitHub access uses REST without vault decryption, normalizes PRs and filters pull requests out of issues", async (t) => {
  const f = await fixture(t, {
    fetch: (call) => {
      assert.equal(call.headers.Authorization, undefined);
      assert.equal(call.redirect, "error");
      if (call.url.includes("/pulls?"))
        return response([
          {
            id: 11,
            number: 3,
            title: "Public PR",
            state: "open",
            user: { login: "author" },
            html_url: "https://github.com/team/repo/pull/3",
            head: { ref: "feature" },
            base: { ref: "main" },
            draft: true,
          },
        ]);
      if (call.url.includes("/issues?"))
        return response([
          {
            id: 12,
            number: 4,
            title: "Real issue",
            user: { login: "reporter" },
          },
          {
            id: 13,
            number: 5,
            title: "PR appearing as issue",
            pull_request: {},
          },
        ]);
      return response({ id: 1, full_name: "team/repo" });
    },
  });
  const status = await f.service.status(f.repo);
  assert.equal(status.authenticated, true);
  assert.match(status.message, /pubblico/);
  const prs = await f.service.list(f.repo, "prs"),
    issues = await f.service.list(f.repo, "issues");
  assert.equal(prs[0].author.login, "author");
  assert.equal(prs[0].headRefName, "feature");
  assert.equal(prs[0].isDraft, true);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].number, 4);
  assert.equal(f.decryptions, 0);
  assert(!f.commands.some((row) => row.command === "gh"));
});

test("GitHub Enterprise uses its configured API prefix and gh fallback remains host-aware for both status and lists", async (t) => {
  const f = await fixture(t, {
    remotes: { origin: "https://enterprise.example/ghe/owner/repo.git" },
    fetch: (call) => {
      assert(
        call.url.startsWith(
          "https://enterprise.example/ghe/api/v3/repos/owner/repo",
        ),
      );
      assert.equal(call.headers.Authorization, "Bearer synthetic-token");
      return response(
        call.url.includes("/pulls?")
          ? [{ id: 1, number: 1, title: "Enterprise PR" }]
          : { id: 1 },
      );
    },
  });
  await profile(f, "github", "https://enterprise.example/ghe");
  assert.equal((await f.service.status(f.repo)).authenticated, true);
  assert.equal((await f.service.list(f.repo))[0].title, "Enterprise PR");
  const fallback = await fixture(t, {
    remotes: { origin: "git@github.com:private/repo.git" },
    fetch: () => response({ message: "Not found" }, 404),
    gh: (args) => {
      assert.deepEqual(args.slice(0, 3), ["api", "--hostname", "github.com"]);
      assert(args[3].startsWith("repos/private/repo"));
      return args[3].includes("?")
        ? [{ id: 1, number: 1, title: "Private CLI PR" }]
        : { id: 1 };
    },
  });
  assert.equal(
    (await fallback.service.status(fallback.repo)).authenticated,
    true,
  );
  assert.equal(
    (await fallback.service.list(fallback.repo))[0].title,
    "Private CLI PR",
  );
  const enterprise = await fixture(t, {
    remotes: { origin: "git@enterprise.example:owner/repo.git" },
    gh: (args) => {
      assert.equal(args[2], "enterprise.example");
      return { id: 1 };
    },
  });
  await profile(enterprise, "github", "https://enterprise.example", "gh", {});
  assert.equal(
    (await enterprise.service.status(enterprise.repo)).authenticated,
    true,
  );
  assert.equal(enterprise.requests.length, 0);
});

test("GitLab preserves a nested namespace and server prefix and uses PAT or OAuth headers explicitly", async (t) => {
  const f = await fixture(t, {
    remotes: { origin: "https://git.example/gitlab/group/sub/project.git" },
    fetch: (call) => {
      assert(
        call.url.startsWith(
          "https://git.example/gitlab/api/v4/projects/group%2Fsub%2Fproject",
        ),
      );
      assert.equal(call.headers["PRIVATE-TOKEN"], "synthetic-token");
      return response(
        call.url.includes("merge_requests?")
          ? [
              {
                id: 100,
                iid: 7,
                title: "MR",
                state: "opened",
                author: { username: "reviewer" },
                source_branch: "source",
                target_branch: "main",
              },
            ]
          : call.url.includes("issues?")
            ? [{ id: 101, iid: 8, title: "Issue", labels: ["triage"] }]
            : { id: 1 },
      );
    },
  });
  await profile(f, "gitlab", "https://git.example/gitlab");
  const prs = await f.service.list(f.repo),
    issues = await f.service.list(f.repo, "issues");
  assert.equal(prs[0].number, 7);
  assert.equal(prs[0].author.login, "reviewer");
  assert.equal(prs[0].headRefName, "source");
  assert.equal(issues[0].labels[0].name, "triage");
  await f.service.save(
    { id: "gitlab", provider: "gitlab", name: "OAuth", authMode: "bearer" },
    { bearerToken: "oauth-token" },
  );
  f.service.fetch = async (_url, options) => {
    assert.equal(options.headers.Authorization, "Bearer oauth-token");
    assert.equal(options.headers["PRIVATE-TOKEN"], undefined);
    return response({ id: 1 });
  };
  assert.equal((await f.service.status(f.repo)).authenticated, true);
});

test("Bitbucket Cloud uses current Basic/API Bearer auth, follows bounded native pagination and exposes no removed issue API", async (t) => {
  const f = await fixture(t, {
    remotes: { origin: "git@bitbucket.org:workspace/repo.git" },
    fetch: (call) => {
      assert(
        call.url.startsWith(
          "https://api.bitbucket.org/2.0/repositories/workspace/repo",
        ),
      );
      assert.equal(
        call.headers.Authorization,
        "Basic " +
          Buffer.from("qa@example.invalid:synthetic-token").toString("base64"),
      );
      if (call.url.includes("page=2"))
        return response({
          values: [
            {
              id: 2,
              title: "Second",
              state: "OPEN",
              author: { nickname: "second" },
            },
          ],
        });
      if (call.url.includes("pullrequests?"))
        return response({
          values: [
            {
              id: 1,
              title: "First",
              state: "OPEN",
              source: { branch: { name: "source" } },
              destination: { branch: { name: "main" } },
            },
          ],
          next: "https://api.bitbucket.org/2.0/repositories/workspace/repo/pullrequests?page=2",
        });
      return response({ uuid: "synthetic-repo" });
    },
  });
  await profile(f, "bitbucket-cloud", "https://bitbucket.org", "basic");
  assert.equal((await f.service.status(f.repo)).capabilities.issues, false);
  assert.equal((await f.service.list(f.repo)).length, 2);
  await assert.rejects(
    f.service.list(f.repo, "issues"),
    /non espone issue native/,
  );
  assert(!f.requests.some((row) => row.url.includes("/issues")));
  await f.service.save(
    {
      id: "bitbucket-cloud",
      provider: "bitbucket-cloud",
      name: "Bearer",
      authMode: "bearer",
    },
    { bearerToken: "api-bearer" },
  );
  f.service.fetch = async (_url, options) => {
    assert.equal(options.headers.Authorization, "Bearer api-bearer");
    return response({ uuid: "repo" });
  };
  assert.equal((await f.service.status(f.repo)).authenticated, true);
});

test("Bitbucket Server preserves context paths, SSH ports and project keys; pull requests use its native API", async (t) => {
  const f = await fixture(t, {
    remotes: { origin: "ssh://git@bitbucket.internal:7999/PROJ/repo.git" },
    fetch: (call) => {
      assert(
        call.url.startsWith(
          "https://bitbucket.internal:8443/bitbucket/rest/api/latest/projects/PROJ/repos/repo",
        ),
      );
      assert.equal(call.headers.Authorization, "Bearer synthetic-token");
      return response(
        call.url.includes("pull-requests?")
          ? {
              values: [
                {
                  id: 12,
                  title: "DC PR",
                  state: "OPEN",
                  author: { user: { slug: "user" } },
                  fromRef: { displayId: "feature" },
                  toRef: { displayId: "main" },
                  updatedDate: 1700000000000,
                },
              ],
              isLastPage: true,
            }
          : { id: 1 },
      );
    },
  });
  await profile(
    f,
    "bitbucket-server",
    "https://bitbucket.internal:8443/bitbucket",
  );
  const status = await f.service.status(f.repo),
    prs = await f.service.list(f.repo);
  assert.equal(status.capabilities.issues, false);
  assert.equal(prs[0].number, 12);
  assert.equal(prs[0].author.login, "user");
  assert.equal(
    prs[0].url,
    "https://bitbucket.internal:8443/bitbucket/projects/PROJ/repos/repo/pull-requests/12/overview",
  );
  await assert.rejects(
    f.service.list(f.repo, "issues"),
    /non espone issue native/,
  );
});

test("Azure cloud/server use collection-scoped native PRs and project WIQL/batch work items without cross-org confusion", async (t) => {
  const f = await fixture(t, {
    remotes: { origin: "git@ssh.dev.azure.com:v3/org/Project/Repo" },
    fetch: (call) => {
      assert(call.url.startsWith("https://dev.azure.com/org/Project/_apis/"));
      assert.equal(
        call.headers.Authorization,
        "Basic " +
          Buffer.from("qa@example.invalid:synthetic-token").toString("base64"),
      );
      if (call.url.includes("/wiql?")) {
        assert.equal(call.method, "POST");
        assert(call.body.query.includes("@project"));
        return response({ workItems: [{ id: 55 }] });
      }
      if (call.url.includes("workitemsbatch?")) {
        assert.deepEqual(call.body.ids, [55]);
        return response({
          value: [
            {
              id: 55,
              fields: {
                "System.Title": "Project work",
                "System.State": "Active",
                "System.ChangedDate": "2026-01-01T00:00:00Z",
              },
            },
          ],
        });
      }
      return response(
        call.url.includes("/pullrequests?")
          ? {
              value: [
                {
                  pullRequestId: 14,
                  title: "Azure PR",
                  status: "active",
                  createdBy: { displayName: "User" },
                  sourceRefName: "refs/heads/feature",
                  targetRefName: "refs/heads/main",
                },
              ],
            }
          : { id: "repo-guid" },
      );
    },
  });
  await profile(f, "azure-devops", "https://dev.azure.com/org", "basic");
  assert.equal(
    (await f.service.status(f.repo)).capabilities.issueScope,
    "project",
  );
  assert.equal((await f.service.list(f.repo))[0].number, 14);
  assert.equal(
    (await f.service.list(f.repo, "issues"))[0].title,
    "Project work",
  );
  await f.service.save(
    {
      id: "wrong",
      name: "Wrong org",
      provider: "azure-devops",
      baseUrl: "https://dev.azure.com/other",
    },
    { apiKey: "isolated" },
  );
  const requestsBefore = f.requests.length;
  await assert.rejects(
    f.service.bind(f.repo, "origin", "wrong"),
    /organizzazione/,
  );
  assert.equal(f.requests.length, requestsBefore);
  f.remotes.origin = "https://dev.azure.com/other/Project/_git/Repo";
  assert.equal((await f.service.status(f.repo)).authenticated, false);
  assert.equal(f.requests.length, requestsBefore);
  const server = await fixture(t, {
    remotes: {
      origin: "https://ado.internal/tfs/Collection/Project/_git/Repo",
    },
    fetch: (call) => {
      assert(
        call.url.includes(
          "/tfs/Collection/Project/_apis/git/repositories/Repo?api-version=7.0",
        ),
      );
      return response({ id: "repo" });
    },
  });
  await server.service.save({
    id: "server",
    name: "Server",
    provider: "azure-devops",
    baseUrl: "https://ado.internal/tfs/Collection",
    apiVersion: "7.0",
    authMode: "none",
  });
  await server.service.bind(server.repo, "origin", "server");
  assert.equal((await server.service.status(server.repo)).authenticated, true);
});

for (const provider of ["gitea", "forgejo"]) {
  test(`${provider} uses instance prefix/native issues and public none mode never decrypts a saved token`, async (t) => {
    const f = await fixture(t, {
      remotes: { origin: "https://forge.internal/code/team/repo.git" },
      fetch: (call) => {
        assert(
          call.url.startsWith(
            "https://forge.internal/code/api/v1/repos/team/repo",
          ),
        );
        assert.equal(call.headers.Authorization, undefined);
        return response(
          call.url.includes("issues?")
            ? [
                {
                  id: 1,
                  number: 1,
                  title: "Native issue",
                  user: { login: "user" },
                },
                { id: 2, number: 2, title: "PR", pull_request: {} },
              ]
            : call.url.includes("pulls?")
              ? [{ id: 3, number: 3, title: "Native PR" }]
              : { id: 1 },
        );
      },
    });
    await profile(f, provider, "https://forge.internal/code", "none");
    const before = f.decryptions;
    assert.equal((await f.service.status(f.repo)).authenticated, true);
    assert.equal((await f.service.list(f.repo, "issues")).length, 1);
    assert.equal((await f.service.list(f.repo))[0].title, "Native PR");
    assert.equal(f.decryptions, before);
    await f.service.save({
      id: provider,
      name: provider,
      provider,
      authMode: "token",
    });
    f.service.fetch = async (_url, options) => {
      assert.equal(options.headers.Authorization, "token synthetic-token");
      return response({ id: 1 });
    };
    assert.equal((await f.service.status(f.repo)).authenticated, true);
  });
}

test("pagination and transport stay bounded, deny cross-host credential forwarding, and sanitize API/CLI failures", async (t) => {
  const token = "synthetic-redaction-key";
  const f = await fixture(t, {
    fetch: (call) => {
      assert.equal(call.redirect, "error");
      return response([{ id: 1, number: 1, title: "First" }], 200, {
        Link: '<https://evil.invalid/repos/team/repo/pulls?page=2>; rel="next"',
      });
    },
  });
  await profile(f, "github", "https://github.com", "token", { apiKey: token });
  await assert.rejects(f.service.list(f.repo), /altro host/);
  assert.equal(f.requests.length, 1);
  f.service.fetch = async () => response({ message: `Echo ${token}` }, 401);
  const status = await f.service.status(f.repo);
  assert.equal(status.authenticated, false);
  assert(!status.message.includes(token));
  assert(status.message.includes("[redacted]"));
  f.service.fetch = async () =>
    new Response("redirect", {
      status: 302,
      headers: { Location: "https://evil.invalid" },
    });
  await assert.rejects(f.service.list(f.repo), /Redirect/);
  f.service.fetch = async () =>
    response([], 200, { "Content-Length": "5000000" });
  await assert.rejects(f.service.list(f.repo), /troppo grande/);
  f.service.fetch = async () =>
    response(
      Array.from({ length: 70 }, (_, i) => ({
        id: i + 1,
        number: i + 1,
        title: "PR",
      })),
    );
  assert.equal((await f.service.list(f.repo)).length, 50);
  f.service.fetch = async () =>
    response([
      {
        id: 1,
        number: 1,
        title: "one",
        head: { ref: token },
        labels: [token],
        html_url: `https://github.com/team/repo/pull/1?token=${token}`,
      },
    ]);
  const safe = await f.service.list(f.repo);
  assert(!JSON.stringify(safe).includes(token));
  assert.equal(safe[0].url, "https://github.com/team/repo/pull/1");
});
