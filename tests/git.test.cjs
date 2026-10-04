/* Copyright (C) 2026 Davide Leopardi
 * SPDX-License-Identifier: GPL-3.0-only */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { GitService } = require("../electron/git.cjs");
const exec = promisify(execFile);

async function fixture(t) {
  const temp = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "branchline-test-")),
    ),
    repo = path.join(temp, "repo");
  const events = [],
    service = new GitService((event) => events.push(event));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  await service.init(repo);
  await service.action(repo, "identity", {
    name: "Integration Test",
    email: "integration@example.invalid",
  });
  const git = async (...args) =>
    (
      await exec("git", ["-C", repo, "-c", "commit.gpgSign=false", ...args], {
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: os.devNull,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_TERMINAL_PROMPT: "0",
        },
      })
    ).stdout.trim();
  await git("config", "commit.gpgSign", "false");
  await git("config", "core.hooksPath", path.join(temp, "empty-hooks"));
  const write = (filename, text) =>
    fs.writeFile(path.join(repo, filename), text);
  const commit = async (
    message,
    filename = "file.txt",
    content = message + "\n",
  ) => {
    await write(filename, content);
    await service.action(repo, "stage", { files: [filename] });
    await service.action(repo, "commit", { message });
    return git("rev-parse", "HEAD");
  };
  return { temp, repo, service, events, git, write, commit };
}

test("snapshot reads the real DAG, refs, rename porcelain, details, blame and file history", async (t) => {
  const { repo, service, git, commit } = await fixture(t);
  const first = await commit("first", "old name.txt", "line one\nline two\n");
  await service.action(repo, "branch.create", {
    name: "feature",
    checkout: true,
  });
  const feature = await commit(
    "feature change",
    "old name.txt",
    "line one\nline changed\n",
  );
  await service.action(repo, "branch.checkout", { name: "main" });
  await commit("main change", "other.txt", "parallel\n");
  await service.action(repo, "merge", { ref: "feature" });
  await service.action(repo, "tag.create", {
    name: "v1",
    message: "Version one",
  });
  const snapshot = await service.snapshot(repo);
  assert.equal(snapshot.branch, "main");
  assert.equal(
    snapshot.commits.find((c) => c.hash === snapshot.head).parents.length,
    2,
  );
  assert(snapshot.commits.some((c) => c.hash === first));
  assert(snapshot.commits.some((c) => c.hash === feature));
  assert.equal(snapshot.tags[0].hash, snapshot.head);
  const merged = await service.commitDetails(repo, snapshot.head);
  assert.equal(merged.files[0].path, "old name.txt");
  assert.match(merged.diff, /line changed/);
  await git("mv", "old name.txt", "new name.txt");
  const renamed = (await service.snapshot(repo)).files.find(
    (f) => f.path === "new name.txt",
  );
  assert.equal(renamed.oldPath, "old name.txt");
  assert.equal(renamed.index, "R");
  assert.equal(renamed.staged, true);
  await service.action(repo, "commit", { message: "rename" });
  const details = await service.commitDetails(repo, "HEAD");
  assert.equal(details.files[0].path, "new name.txt");
  assert.match(details.files[0].status, /^R/);
  assert.match(details.diff, /rename from old name.txt/);
  assert.equal(
    await service.file(repo, "new name.txt", "HEAD"),
    "line one\nline changed\n",
  );
  assert.match(await service.blame(repo, "new name.txt"), /Integration Test/);
  assert.equal((await service.history(repo, "new name.txt")).length, 3);
});

test("stage/unstage initial commits, bounded log, partial hunk staging and unstage use the actual index", async (t) => {
  const { repo, service, write, commit, git } = await fixture(t);
  await write("file.txt", "one\ntwo\nthree\n");
  await service.action(repo, "stage", { files: [] });
  assert((await service.snapshot(repo)).files[0].staged);
  await service.action(repo, "unstage", { files: [] });
  assert.equal((await service.snapshot(repo)).files[0].index, "?");
  await commit("base", "file.txt", "one\ntwo\nthree\n");
  await write("file.txt", "ONE\ntwo\nthree\n");
  const patch = await service.diff(repo, { file: "file.txt" });
  await service.action(repo, "hunk.stage", { patch });
  assert.match(await service.diff(repo, { staged: true }), /\+ONE/);
  assert.equal(await service.diff(repo, { file: "file.txt" }), "");
  await service.action(repo, "hunk.unstage", { patch });
  assert.equal(await service.diff(repo, { staged: true }), "");
  assert.match(await service.diff(repo, { file: "file.txt" }), /\+ONE/);
  await service.action(repo, "stage", { files: ["file.txt"] });
  await service.action(repo, "commit", { message: "second" });
  assert.equal((await service.snapshot(repo, 1)).commits.length, 1);
  assert.equal(await git("show", "HEAD:file.txt"), "ONE\ntwo\nthree");
});

test("discard and restore keep tracked and untracked data recoverable", async (t) => {
  const { repo, service, write, commit } = await fixture(t);
  await commit("base", "file.txt", "committed\n");
  await write("file.txt", "valuable changed text\n");
  await write("new.txt", "untracked work\n");
  const result = await service.action(repo, "discard", {
    files: ["file.txt", "new.txt"],
  });
  const id = /backup "([\d]+-[a-f\d]{8})"/.exec(result.output)[1];
  assert.equal(
    await fs.readFile(path.join(repo, "file.txt"), "utf8"),
    "committed\n",
  );
  await assert.rejects(fs.access(path.join(repo, "new.txt")));
  await service.action(repo, "discard.restore", { backup: id });
  assert.equal(
    await fs.readFile(path.join(repo, "file.txt"), "utf8"),
    "valuable changed text\n",
  );
  assert.equal(
    await fs.readFile(path.join(repo, "new.txt"), "utf8"),
    "untracked work\n",
  );
  await assert.rejects(
    service.action(repo, "discard.restore", { backup: "../outside" }),
    /Invalid recovery/,
  );
});

test("stash creates and restores untracked work, pop and drop retain backup refs", async (t) => {
  const { repo, service, commit, write, git } = await fixture(t);
  await commit("base");
  await write("file.txt", "modified\n");
  await write("new.txt", "new\n");
  await service.action(repo, "stash.create", {
    message: "saved work",
    includeUntracked: true,
  });
  assert.equal((await service.snapshot(repo)).files.length, 0);
  assert.match((await service.snapshot(repo)).stashes[0].subject, /saved work/);
  const result = await service.action(repo, "stash.pop", { ref: "stash@{0}" });
  assert.match(result.output, /Recovery ref:/);
  assert.equal(await fs.readFile(path.join(repo, "new.txt"), "utf8"), "new\n");
  assert.equal((await service.snapshot(repo)).stashes.length, 0);
  assert(
    (
      await git(
        "for-each-ref",
        "--format=%(refname)",
        "refs/branchline/backups",
      )
    ).length > 0,
  );
  await assert.rejects(
    service.action(repo, "stash.drop", { ref: "--all" }),
    /invalid/,
  );
});

test("merge conflicts expose operation and can be resolved with content and continued or aborted", async (t) => {
  const { repo, service, commit, git } = await fixture(t);
  await commit("base", "file.txt", "base\n");
  await service.action(repo, "branch.create", {
    name: "feature",
    checkout: true,
  });
  await commit("feature", "file.txt", "feature\n");
  await service.action(repo, "branch.checkout", { name: "main" });
  await commit("main", "file.txt", "main\n");
  await assert.rejects(
    service.action(repo, "merge", { ref: "feature" }),
    /CONFLICT/,
  );
  const conflict = await service.snapshot(repo);
  assert.equal(conflict.operation, "merge");
  assert(conflict.files[0].conflict);
  await service.action(repo, "conflict.resolve", {
    file: "file.txt",
    content: "combined\n",
  });
  await service.action(repo, "operation.continue", { kind: "merge" });
  assert.equal((await service.snapshot(repo)).operation, null);
  assert.equal(
    (await git("rev-list", "--parents", "-1", "HEAD")).split(" ").length,
    3,
  );
  await service.action(repo, "branch.create", {
    name: "another",
    start: "HEAD~1",
    checkout: true,
  });
  await commit("another", "file.txt", "another\n");
  await assert.rejects(
    service.action(repo, "merge", { ref: "main" }),
    /CONFLICT/,
  );
  await service.action(repo, "operation.abort", { kind: "merge" });
  assert.equal((await service.snapshot(repo)).operation, null);
  assert.equal(
    await fs.readFile(path.join(repo, "file.txt"), "utf8"),
    "another\n",
  );
});

test("rebase, cherry-pick and revert operate on validated real refs", async (t) => {
  const { repo, service, commit, git } = await fixture(t);
  await commit("base");
  await service.action(repo, "branch.create", {
    name: "feature",
    checkout: true,
  });
  const feature = await commit("feature", "feature.txt", "feature\n");
  await service.action(repo, "branch.checkout", { name: "main" });
  const main = await commit("main", "main.txt", "main\n");
  await service.action(repo, "branch.checkout", { name: "feature" });
  await service.action(repo, "rebase", { ref: "main" });
  assert.equal(await git("rev-parse", "HEAD^"), main);
  await service.action(repo, "branch.checkout", { name: "main" });
  await service.action(repo, "cherryPick", { hash: feature });
  assert.equal(
    await fs.readFile(path.join(repo, "feature.txt"), "utf8"),
    "feature\n",
  );
  await service.action(repo, "revert", { hash: "HEAD" });
  await assert.rejects(fs.access(path.join(repo, "feature.txt")));
});

test("commit and hard reset undo/redo preserve the worktree and refuse stale HEAD", async (t) => {
  const { repo, service, commit, write, git } = await fixture(t);
  const first = await commit("first", "file.txt", "first\n");
  const second = await commit("second", "file.txt", "second\n");
  await service.action(repo, "undo");
  assert.equal(await git("rev-parse", "HEAD"), first);
  assert.equal(
    await fs.readFile(path.join(repo, "file.txt"), "utf8"),
    "second\n",
  );
  assert.match(await service.diff(repo, { staged: true }), /\+second/);
  await service.action(repo, "redo");
  assert.equal(await git("rev-parse", "HEAD"), second);
  assert.equal((await service.snapshot(repo)).files.length, 0);
  await write("file.txt", "valuable uncommitted\n");
  await write("new.txt", "valuable untracked\n");
  const reset = await service.action(repo, "reset", {
    ref: first,
    mode: "hard",
  });
  assert.match(reset.output, /recovery stash/);
  assert.equal(
    await fs.readFile(path.join(repo, "file.txt"), "utf8"),
    "first\n",
  );
  await service.action(repo, "undo");
  assert.equal(await git("rev-parse", "HEAD"), second);
  assert.equal(
    await fs.readFile(path.join(repo, "file.txt"), "utf8"),
    "valuable uncommitted\n",
  );
  assert.equal(
    await fs.readFile(path.join(repo, "new.txt"), "utf8"),
    "valuable untracked\n",
  );
  await service.action(repo, "stage", { files: [] });
  await service.action(repo, "commit", { message: "third" });
  await git("commit", "--allow-empty", "-m", "external change");
  await assert.rejects(service.action(repo, "undo"), /HEAD changed/);
});

test("interactive rebase validates complete membership and supports reword, fixup, squash and drop", async (t) => {
  const { repo, service, commit, git } = await fixture(t);
  const base = await commit("base");
  const one = await commit("one", "one.txt", "one\n");
  const two = await commit("two", "two.txt", "two\n");
  const three = await commit("three", "three.txt", "three\n");
  const four = await commit("four", "four.txt", "four\n");
  const five = await commit("five", "five.txt", "five\n");
  const plan = await service.rebasePlan(repo, base);
  assert.deepEqual(
    plan.map((row) => row.hash),
    [one, two, three, four, five],
  );
  await assert.rejects(
    service.action(repo, "interactive.rebase", {
      base,
      plan: [{ hash: one, action: "pick" }],
    }),
    /every commit/,
  );
  await assert.rejects(
    service.action(repo, "interactive.rebase", {
      base,
      plan: plan.map((row, i) => ({
        hash: i === 1 ? one : row.hash,
        action: "pick",
      })),
    }),
    /duplicate/,
  );
  await service.action(repo, "interactive.rebase", {
    base,
    plan: [
      { hash: one, action: "reword", message: "renamed first" },
      { hash: two, action: "fixup" },
      { hash: three, action: "pick" },
      { hash: four, action: "squash", message: "combined three and four" },
      { hash: five, action: "drop" },
    ],
  });
  assert.equal(await git("rev-list", "--count", `${base}..HEAD`), "2");
  assert.equal(
    await git("log", "-1", "--format=%s"),
    "combined three and four",
  );
  assert.equal(await git("log", "-1", "--format=%s", "HEAD^"), "renamed first");
  await assert.rejects(fs.access(path.join(repo, "five.txt")));
  assert.equal((await service.snapshot(repo)).operation, null);
});

test("undo is bound to the original branch and mixed reset recovers index-only content", async (t) => {
  const { repo, service, commit, write, git } = await fixture(t);
  const first = await commit("first", "file.txt", "first\n");
  const second = await commit("second", "file.txt", "second\n");
  await service.action(repo, "branch.create", {
    name: "same-head",
    checkout: true,
  });
  await assert.rejects(service.action(repo, "undo"), /different branch/);
  assert.equal(await git("rev-parse", "HEAD"), second);
  await service.action(repo, "branch.checkout", { name: "main" });
  await write("file.txt", "index-only content\n");
  await service.action(repo, "stage", { files: ["file.txt"] });
  await write("file.txt", "working-only content\n");
  await service.action(repo, "reset", { ref: first, mode: "mixed" });
  assert.equal(await git("show", ":file.txt"), "first");
  await service.action(repo, "undo");
  assert.equal(await git("show", ":file.txt"), "index-only content");
  assert.equal(
    await fs.readFile(path.join(repo, "file.txt"), "utf8"),
    "working-only content\n",
  );
  await service.action(repo, "redo");
  assert.equal(await git("show", ":file.txt"), "first");
  assert.equal(
    await fs.readFile(path.join(repo, "file.txt"), "utf8"),
    "working-only content\n",
  );
});

test("interactive rebase continuation preserves planned messages after conflicts", async (t) => {
  const { repo, service, commit, git } = await fixture(t);
  const base = await commit("base", "file.txt", "base\n");
  const one = await commit("first", "file.txt", "one\n");
  const two = await commit("second", "file.txt", "two\n");
  await assert.rejects(
    service.action(repo, "interactive.rebase", {
      base,
      plan: [
        { hash: two, action: "pick" },
        { hash: one, action: "reword", message: "retained planned message" },
      ],
    }),
    /CONFLICT/,
  );
  assert.equal((await service.snapshot(repo)).operation, "rebase");
  await service.action(repo, "conflict.resolve", {
    file: "file.txt",
    content: "two resolved\n",
  });
  await assert.rejects(
    service.action(repo, "operation.continue", { kind: "rebase" }),
    /CONFLICT/,
  );
  await service.action(repo, "conflict.resolve", {
    file: "file.txt",
    content: "one resolved\n",
  });
  await service.action(repo, "operation.continue", { kind: "rebase" });
  assert.equal((await service.snapshot(repo)).operation, null);
  assert.equal(
    await git("log", "-1", "--format=%s"),
    "retained planned message",
  );
  assert.equal(await git("log", "-1", "--format=%s", "HEAD^"), "second");
});

test("hard reset refuses to overwrite ignored files or file-directory obstructions", async (t) => {
  const { repo, service, commit, write, git } = await fixture(t);
  await commit("base");
  await service.action(repo, "branch.create", {
    name: "target",
    checkout: true,
  });
  await fs.mkdir(path.join(repo, "build"));
  const target = await commit(
    "tracked draft",
    "build/draft.txt",
    "tracked draft\n",
  );
  await service.action(repo, "branch.checkout", { name: "main" });
  await write(".gitignore", "build/\n");
  await service.action(repo, "stage", { files: [".gitignore"] });
  await service.action(repo, "commit", { message: "ignore build" });
  await fs.mkdir(path.join(repo, "build"), { recursive: true });
  await write("build/draft.txt", "ignored valuable draft\n");
  const old = await git("rev-parse", "HEAD");
  await assert.rejects(
    service.action(repo, "reset", { ref: target, mode: "hard" }),
    /overwrite ignored content/,
  );
  assert.equal(await git("rev-parse", "HEAD"), old);
  assert.equal(
    await fs.readFile(path.join(repo, "build/draft.txt"), "utf8"),
    "ignored valuable draft\n",
  );
});

test("paths, symlinks, patch traversal and option injection cannot access outside the repository", async (t) => {
  const { repo, temp, service, commit } = await fixture(t);
  await commit("base");
  await fs.writeFile(path.join(temp, "outside.txt"), "outside secret\n");
  await fs.symlink(path.join(temp, "outside.txt"), path.join(repo, "escape"));
  for (const file of [
    "../outside.txt",
    path.join(temp, "outside.txt"),
    "escape",
    ".git/config",
  ]) {
    await assert.rejects(service.file(repo, file), /inside|outside/);
    await assert.rejects(
      service.action(repo, "stage", { files: [file] }),
      /inside|outside/,
    );
  }
  await assert.rejects(
    service.action(repo, "branch.create", { name: "--evil" }),
    /invalid/,
  );
  await assert.rejects(
    service.action(repo, "merge", { ref: "--help" }),
    /invalid/,
  );
  const patch =
    "diff --git a/../outside.txt b/../outside.txt\n--- a/../outside.txt\n+++ b/../outside.txt\n@@ -1 +1 @@\n-outside secret\n+changed\n";
  await assert.rejects(
    service.action(repo, "patch.apply", { patch }),
    /inside/,
  );
  assert.equal(
    await fs.readFile(path.join(temp, "outside.txt"), "utf8"),
    "outside secret\n",
  );
  await assert.rejects(
    service.clone("ext::sh -c echo bad", path.join(temp, "evil")),
    /ext Git transport/,
  );
});

test("clone, remote fetch/push tracking, linked worktrees and concurrent mutations use isolated repositories", async (t) => {
  const { repo, temp, service, commit, git, events } = await fixture(t);
  await commit("base");
  const remote = path.join(temp, "remote.git");
  await exec("git", ["init", "--bare", "--initial-branch=main", remote]);
  await service.action(repo, "remote.add", { name: "origin", url: remote });
  await service.action(repo, "push", {
    remote: "origin",
    branch: "main",
    setUpstream: true,
  });
  const snapshot = await service.snapshot(repo);
  assert.equal(snapshot.upstream, "origin/main");
  assert.equal(snapshot.ahead, 0);
  assert.equal(snapshot.behind, 0);
  const clone = path.join(temp, "clone");
  assert.equal((await service.clone(remote, clone)).branch, "main");
  await service.action(repo, "fetch", { remote: "origin", prune: true });
  const linked = path.join(temp, "linked");
  await service.action(repo, "worktree.add", {
    destination: linked,
    newBranch: "linked",
  });
  assert(
    (await service.snapshot(repo)).worktrees.some(
      (w) => w.path === linked && w.branch === "linked",
    ),
  );
  await service.action(repo, "worktree.lock", { destination: linked });
  assert(
    (await service.snapshot(repo)).worktrees.find((w) => w.path === linked)
      .locked,
  );
  await service.action(repo, "worktree.unlock", { destination: linked });
  await service.action(repo, "worktree.remove", { destination: linked });
  await Promise.all([
    service.action(repo, "branch.create", { name: "parallel-a" }),
    service.action(repo, "branch.create", { name: "parallel-b" }),
  ]);
  assert.match(await git("branch", "--list"), /parallel-a/);
  assert.match(await git("branch", "--list"), /parallel-b/);
  assert(events.some((event) => event.success && event.operation === "push"));
  assert(
    events.every(
      (event) =>
        typeof event.command === "string" && typeof event.output === "string",
    ),
  );
});

test("ignore, untrack, patch import/export and Git Flow feature lifecycle preserve real state", async (t) => {
  const { repo, service, commit, write, git } = await fixture(t);
  await commit("base");
  await service.action(repo, "ignore", {
    files: ["cache[1].txt", "some name.txt"],
  });
  await write("cache[1].txt", "ignored\n");
  await write("some name.txt", "ignored\n");
  assert.equal(
    (await service.snapshot(repo)).files.filter(
      (f) => f.path.includes("cache") || f.path === "some name.txt",
    ).length,
    0,
  );
  await service.action(repo, "stage", { files: [".gitignore"] });
  await service.action(repo, "commit", { message: "ignore" });
  await write("file.txt", "new text\n");
  const patch = (
    await service.action(repo, "patch.export", { file: "file.txt" })
  ).output;
  await service.action(repo, "discard", { files: ["file.txt"] });
  await service.action(repo, "patch.apply", { patch });
  assert.equal(
    await fs.readFile(path.join(repo, "file.txt"), "utf8"),
    "new text\n",
  );
  await service.action(repo, "stage", { files: ["file.txt"] });
  await service.action(repo, "commit", { message: "patch" });
  await service.action(repo, "untrack", { files: ["file.txt"] });
  assert.equal(
    await fs.readFile(path.join(repo, "file.txt"), "utf8"),
    "new text\n",
  );
  await service.action(repo, "unstage", { files: ["file.txt"] });
  await service.action(repo, "gitflow.init", {
    main: "main",
    develop: "develop",
  });
  await service.action(repo, "gitflow.start", {
    kind: "feature",
    name: "example",
  });
  await commit("feature flow", "flow.txt", "feature\n");
  await service.action(repo, "gitflow.finish", {
    kind: "feature",
    name: "example",
  });
  assert.equal((await service.snapshot(repo)).branch, "develop");
  assert.equal(await git("branch", "--list", "feature/example"), "");
  assert.equal(
    await fs.readFile(path.join(repo, "flow.txt"), "utf8"),
    "feature\n",
  );
});

test("modify/delete conflicts distinguish missing stages from empty files and preserve the selected resolution", async (t) => {
  const cases = [
    {
      name: "keep an empty theirs version",
      resolution: { strategy: "theirs" },
      keep: true,
    },
    {
      name: "keep explicitly edited empty content",
      resolution: { content: "" },
      keep: true,
    },
    { name: "explicit removal", resolution: { remove: true }, keep: false },
    {
      name: "missing ours means deletion",
      resolution: { strategy: "ours" },
      keep: false,
    },
    {
      name: "missing theirs means deletion",
      resolution: { strategy: "theirs" },
      keep: false,
      reverse: true,
    },
    { name: "abort restores the original deletion", abort: true, keep: false },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async (subtest) => {
      const { repo, service, commit, git } = await fixture(subtest);
      await commit("base greeting", "greeting.txt", "Hello from base.\n");
      await service.action(repo, "branch.create", {
        name: "side",
        checkout: true,
      });
      if (scenario.reverse) {
        await git("rm", "--", "greeting.txt");
        await service.action(repo, "commit", {
          message: "side deletes greeting",
        });
      } else {
        await commit("side keeps an empty greeting", "greeting.txt", "");
      }
      await service.action(repo, "branch.checkout", { name: "main" });
      if (scenario.reverse) {
        await commit("main keeps an empty greeting", "greeting.txt", "");
      } else {
        await git("rm", "--", "greeting.txt");
        await service.action(repo, "commit", {
          message: "main deletes greeting",
        });
      }
      const originalHead = await git("rev-parse", "HEAD");
      await assert.rejects(
        service.action(repo, "merge", { ref: "side" }),
        /CONFLICT/,
      );
      const versions = await service.conflictVersions(repo, "greeting.txt");
      assert.equal(versions.base, "Hello from base.\n");
      assert.equal(versions.ours, "");
      assert.equal(versions.theirs, "");
      assert.deepEqual(versions.present, {
        base: true,
        ours: !!scenario.reverse,
        theirs: !scenario.reverse,
        working: true,
      });
      assert.equal(versions.working, "");
      if (scenario.abort) {
        await service.action(repo, "operation.abort", { kind: "merge" });
        assert.equal(await git("rev-parse", "HEAD"), originalHead);
      } else {
        await service.action(repo, "conflict.resolve", {
          file: "greeting.txt",
          ...scenario.resolution,
        });
        assert(
          !(await service.snapshot(repo)).files.some((file) => file.conflict),
        );
        if (scenario.keep) {
          assert.match(
            await git("ls-files", "--stage", "--", "greeting.txt"),
            /100644 e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 0/,
          );
        } else {
          assert.equal(
            await git("ls-files", "--stage", "--", "greeting.txt"),
            "",
          );
        }
        await service.action(repo, "operation.continue", { kind: "merge" });
        assert.equal(
          (await git("rev-list", "--parents", "-1", "HEAD")).split(" ").length,
          3,
        );
        await assert.rejects(
          service.conflictVersions(repo, "greeting.txt"),
          /no unresolved conflict/,
        );
      }
      assert.equal((await service.snapshot(repo)).operation, null);
      if (scenario.keep) {
        assert.equal(
          await fs.readFile(path.join(repo, "greeting.txt"), "utf8"),
          "",
        );
        assert.equal(
          await git("ls-tree", "--name-only", "HEAD", "--", "greeting.txt"),
          "greeting.txt",
        );
      } else {
        await assert.rejects(fs.access(path.join(repo, "greeting.txt")), {
          code: "ENOENT",
        });
        assert.equal(
          await git("ls-tree", "--name-only", "HEAD", "--", "greeting.txt"),
          "",
        );
      }
    });
  }
});
