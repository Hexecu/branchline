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
const untrackedName =
  process.platform === "win32" ? "new ☘.txt" : "new \n☘.txt";
const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  GIT_EDITOR: "true",
};

async function gitAt(repo, ...args) {
  return (
    await exec("git", ["-C", repo, "-c", "commit.gpgSign=false", ...args], {
      env,
    })
  ).stdout;
}
async function fixture(t) {
  const temp = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "branchline-autostash-")),
  );
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const repo = path.join(temp, "repo"),
    service = new GitService();
  await service.init(repo);
  const git = (...args) => gitAt(repo, ...args);
  await git("config", "user.name", "Autostash QA");
  await git("config", "user.email", "qa@example.invalid");
  await git("config", "commit.gpgSign", "false");
  await git("config", "core.hooksPath", path.join(temp, "no-hooks"));
  const write = async (file, content) => {
    await fs.mkdir(path.dirname(path.join(repo, file)), { recursive: true });
    await fs.writeFile(path.join(repo, file), content);
  };
  const commit = async (message, file, content) => {
    if (file) await write(file, content);
    await git("add", "-A");
    await git("commit", "-m", message);
    return (await git("rev-parse", "HEAD")).trim();
  };
  await write("local.txt", "base local\n");
  await write("shared.txt", "base shared\n");
  await write(".gitignore", "/ignored/\n");
  const base = await commit("base");
  return { temp, repo, service, git, write, commit, base };
}
async function dirty(f) {
  await f.write("local.txt", "staged local\n");
  await f.git("add", "--", "local.txt");
  await f.write("local.txt", "unstaged local\n");
  await f.write(untrackedName, "untracked with no final newline");
  await f.write("ignored/private.txt", "ignored private work\n");
  return f.git("status", "--porcelain=v1", "-z", "--untracked-files=all");
}
async function restored(f, expectedStatus) {
  assert.equal(await f.git("show", ":local.txt"), "staged local\n");
  assert.equal(
    await fs.readFile(path.join(f.repo, "local.txt"), "utf8"),
    "unstaged local\n",
  );
  assert.equal(
    await fs.readFile(path.join(f.repo, untrackedName), "utf8"),
    "untracked with no final newline",
  );
  assert.equal(
    await fs.readFile(path.join(f.repo, "ignored/private.txt"), "utf8"),
    "ignored private work\n",
  );
  assert.equal(
    await f.git("status", "--porcelain=v1", "-z", "--untracked-files=all"),
    expectedStatus,
  );
}
async function assertRecovery(f, state, expectListed) {
  assert.match(state.hash, /^[a-f\d]{40,64}$/);
  assert.match(state.ref, /^refs\/branchline\/backups\//);
  assert.equal((await f.git("rev-parse", state.ref)).trim(), state.hash);
  assert.equal(
    await f.git("show", `${state.ref}^2:local.txt`),
    "staged local\n",
  );
  assert.equal(
    await f.git("show", `${state.ref}:local.txt`),
    "unstaged local\n",
  );
  assert.equal(
    await f.git("show", `${state.ref}^3:${untrackedName}`),
    "untracked with no final newline",
  );
  assert.equal(
    (await f.git("stash", "list", "--format=%H"))
      .split("\n")
      .includes(state.hash),
    expectListed,
  );
}

test("commit checkout validates hashes, detaches at the selected commit and retains the previous tip", async (t) => {
  const f = await fixture(t);
  const tip = await f.commit("new tip", "shared.txt", "new tip\n");
  for (const hash of ["--detach", "main", "not-a-hash", "a".repeat(40)]) {
    await assert.rejects(f.service.action(f.repo, "commit.checkout", { hash }));
    assert.equal((await f.git("rev-parse", "HEAD")).trim(), tip);
  }
  const result = await f.service.action(f.repo, "commit.checkout", {
    hash: f.base.slice(0, 10),
  });
  const ref = /Recovery ref: (\S+)/.exec(result.output)[1];
  assert.equal((await f.git("rev-parse", "HEAD")).trim(), f.base);
  assert.equal((await f.git("rev-parse", ref)).trim(), tip);
  const snapshot = await f.service.snapshot(f.repo);
  assert.equal(snapshot.branch, "Detached HEAD");
  assert(snapshot.commits.some((commit) => commit.hash === f.base));
  assert.match(result.output, /Create a branch/);
});

test("autostash is opt-in, restores staged/unstaged/untracked separately and preserves stash entries for explicit cleanup", async (t) => {
  const f = await fixture(t);
  await f.git("switch", "-c", "target");
  await f.commit("target", "remote.txt", "target content\n");
  await f.git("switch", "main");
  await f.write("shared.txt", "existing stash content\n");
  await f.git("stash", "push", "-m", "older user stash");
  const old = (await f.git("rev-parse", "refs/stash")).trim();
  const status = await dirty(f);
  const result = await f.service.action(f.repo, "branch.checkout", {
    name: "target",
    autoStash: true,
  });
  assert.equal(
    (await f.git("symbolic-ref", "--short", "HEAD")).trim(),
    "target",
  );
  await restored(f, status);
  assert.equal(
    await fs.readFile(path.join(f.repo, "remote.txt"), "utf8"),
    "target content\n",
  );
  assert.equal(result.autoStash.restored, true);
  assert.equal(result.autoStash.conflict, false);
  await assertRecovery(f, result.autoStash, true);
  assert(
    (await f.git("stash", "list", "--format=%H")).split("\n").includes(old),
  );
  assert.equal((await new GitService().snapshot(f.repo)).autoStash, undefined);
});

test("dirty clash without opt-in preserves local data and gives a retry notice even with Git autostash configured", async (t) => {
  const f = await fixture(t);
  await f.git("switch", "-c", "target");
  await f.commit("target", "local.txt", "other branch\n");
  await f.git("switch", "main");
  const status = await dirty(f);
  await f.git("config", "rebase.autoStash", "true");
  await f.git("config", "merge.autoStash", "true");
  await assert.rejects(
    f.service.action(f.repo, "branch.checkout", { name: "target" }),
    /Autostash enabled/,
  );
  await assert.rejects(
    f.service.action(f.repo, "rebase", { ref: "target" }),
    /Autostash enabled/,
  );
  assert.equal((await f.git("symbolic-ref", "--short", "HEAD")).trim(), "main");
  await restored(f, status);
  assert.equal(await f.git("stash", "list"), "");
  assert.equal((await f.service.snapshot(f.repo)).autoStash, undefined);
});

test("checkout failure retains the stable stash/ref without automatically reapplying it, and recovery works after restart", async (t) => {
  const f = await fixture(t);
  await f.git("branch", "held");
  await f.git("worktree", "add", path.join(f.temp, "held"), "held");
  const status = await dirty(f);
  await assert.rejects(
    f.service.action(f.repo, "branch.checkout", {
      name: "held",
      autoStash: true,
    }),
    /retained without automatic restoration/,
  );
  const state = (await new GitService().snapshot(f.repo)).autoStash;
  assert.equal(state.originalBranch, "main");
  assert.equal(state.awaitingOperation, null);
  assert.equal((await f.git("rev-parse", "HEAD")).trim(), f.base);
  assert.equal(await f.git("show", ":local.txt"), "base local\n");
  await assert.rejects(fs.access(path.join(f.repo, untrackedName)));
  await assertRecovery(f, state, true);
  await new GitService().action(f.repo, "stash.apply", {
    ref: state.ref,
    index: true,
  });
  await restored(f, status);
  assert.equal((await f.service.snapshot(f.repo)).autoStash, undefined);
});

test("an external Git process changing stash ordinals cannot make automatic restoration delete its stash", async (t) => {
  const f = await fixture(t),
    external = path.join(f.temp, "external");
  await f.git("branch", "target");
  await f.git("worktree", "add", "-b", "external", external, "main");
  const status = await dirty(f),
    original = f.service.git.bind(f.service);
  let unrelated = "",
    dropCalls = 0;
  const externalStash = async (content) => {
    await fs.writeFile(path.join(external, "outside.txt"), content);
    await gitAt(
      external,
      "stash",
      "push",
      "--include-untracked",
      "-m",
      "External Git changes",
    );
    return (await gitAt(external, "rev-parse", "refs/stash")).trim();
  };
  f.service.git = async (repo, args, options) => {
    if (args[0] === "stash" && args[1] === "drop") {
      dropCalls++;
      // This is the unsafe ordinal window: a new entry moves every index.
      await externalStash("second unrelated entry\n");
    }
    const output = await original(repo, args, options);
    if (args[0] === "stash" && args[1] === "apply")
      unrelated = await externalStash("valuable unrelated entry\n");
    return output;
  };
  const result = await f.service.action(f.repo, "branch.checkout", {
    name: "target",
    autoStash: true,
  });
  assert.equal(dropCalls, 0);
  assert(unrelated);
  const hashes = (await f.git("stash", "list", "--format=%H")).split("\n");
  assert(hashes.includes(unrelated));
  assert(hashes.includes(result.autoStash.hash));
  await restored(f, status);
  assert.equal((await f.service.snapshot(f.repo)).autoStash, undefined);
});

test("explicitly dropping a resolved pending autostash clears its blocker while retaining the recovery ref", async (t) => {
  const f = await fixture(t);
  await f.git("switch", "-c", "target");
  await f.commit("target shared", "shared.txt", "target shared\n");
  await f.git("switch", "main");
  await f.write("shared.txt", "uncommitted shared\n");
  await assert.rejects(
    f.service.action(f.repo, "branch.checkout", {
      name: "target",
      autoStash: true,
    }),
    /restoration conflict/,
  );
  const pending = (await f.service.snapshot(f.repo)).autoStash;
  await f.service.action(f.repo, "conflict.resolve", {
    file: "shared.txt",
    content: "resolved shared\n",
  });
  await f.service.action(f.repo, "stash.drop", { ref: "stash@{0}" });
  assert.equal((await f.service.snapshot(f.repo)).autoStash, undefined);
  assert.equal((await f.git("rev-parse", pending.ref)).trim(), pending.hash);
  const result = await f.service.action(f.repo, "branch.checkout", {
    name: "target",
    autoStash: true,
  });
  assert.equal(result.autoStash.restored, true);
  assert.equal(await f.git("show", ":shared.txt"), "resolved shared\n");
});

test("restore conflicts keep the target checkout and stash available, expose conflicts and retain the complete recovery data", async (t) => {
  const f = await fixture(t);
  await f.git("switch", "-c", "target");
  const target = await f.commit(
    "target shared",
    "shared.txt",
    "target shared\n",
  );
  await f.git("switch", "main");
  await dirty(f);
  await f.write("shared.txt", "uncommitted shared\n");
  const status = await f.git(
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  );
  await assert.rejects(
    f.service.action(f.repo, "branch.checkout", {
      name: "target",
      autoStash: true,
    }),
    /Autostash restoration conflict/,
  );
  const snapshot = await f.service.snapshot(f.repo),
    state = snapshot.autoStash;
  assert.equal(snapshot.head, target);
  assert.equal(snapshot.branch, "target");
  assert.equal(snapshot.operation, null);
  assert.equal(state.conflict, true);
  assert.equal(state.restored, false);
  assert(
    snapshot.files.some((file) => file.path === "shared.txt" && file.conflict),
  );
  await assertRecovery(f, state, true);
  // Explicitly discard this fixture's attempted application, return to the
  // original branch, then recover from the stable ref rather than stash ordinal.
  await f.git("reset", "--hard", target);
  await fs.rm(path.join(f.repo, untrackedName), { force: true });
  await f.service.action(f.repo, "branch.checkout", { name: "main" });
  await f.service.action(f.repo, "stash.apply", {
    ref: state.ref,
    index: true,
  });
  await restored(f, status);
  assert.equal(
    await fs.readFile(path.join(f.repo, "shared.txt"), "utf8"),
    "uncommitted shared\n",
  );
});

for (const operation of ["merge", "rebase"]) {
  for (const finish of ["abort", "continue"]) {
    test(`${operation} conflict defers restoration until explicit ${finish} succeeds`, async (t) => {
      const f = await fixture(t);
      await f.git("switch", "-c", "side");
      await f.commit("side shared", "shared.txt", "side shared\n");
      await f.git("switch", "main");
      const original = await f.commit(
        "main shared",
        "shared.txt",
        "main shared\n",
      );
      const status = await dirty(f);
      await assert.rejects(
        f.service.action(f.repo, operation, { ref: "side", autoStash: true }),
        /retained without automatic restoration/,
      );
      const state = (await f.service.snapshot(f.repo)).autoStash;
      assert.equal((await f.service.snapshot(f.repo)).operation, operation);
      assert.equal(state.awaitingOperation, operation);
      assert.equal(await f.git("show", ":local.txt"), "base local\n");
      await assert.rejects(fs.access(path.join(f.repo, untrackedName)));
      await assertRecovery(f, state, true);
      if (finish === "continue")
        await f.service.action(f.repo, "conflict.resolve", {
          file: "shared.txt",
          content: "resolved shared\n",
        });
      const result = await new GitService().action(
        f.repo,
        `operation.${finish}`,
        { kind: operation },
      );
      assert.equal(result.autoStash.hash, state.hash);
      assert.equal(result.autoStash.restored, true);
      await restored(f, status);
      await assertRecovery(f, state, true);
      assert.equal((await f.service.snapshot(f.repo)).operation, null);
      assert.equal((await f.service.snapshot(f.repo)).autoStash, undefined);
      assert.equal(
        (await f.git("symbolic-ref", "--short", "HEAD")).trim(),
        "main",
      );
      if (finish === "abort")
        assert.equal((await f.git("rev-parse", "HEAD")).trim(), original);
      else
        assert.equal(
          await fs.readFile(path.join(f.repo, "shared.txt"), "utf8"),
          "resolved shared\n",
        );
    });
  }
}

for (const operation of ["merge", "rebase", "commit.checkout"]) {
  test(`${operation} succeeds with opt-in and restores both index and worktree changes`, async (t) => {
    const f = await fixture(t);
    await f.git("switch", "-c", "side");
    const target = await f.commit(
      "side unrelated",
      "side.txt",
      "side content\n",
    );
    await f.git("switch", "main");
    if (operation === "rebase")
      await f.commit("local committed", "main.txt", "main content\n");
    const status = await dirty(f);
    const result = await f.service.action(
      f.repo,
      operation,
      operation === "commit.checkout"
        ? { hash: target, autoStash: true }
        : { ref: "side", autoStash: true },
    );
    await restored(f, status);
    await assertRecovery(f, result.autoStash, true);
    assert.equal(
      await fs.readFile(path.join(f.repo, "side.txt"), "utf8"),
      "side content\n",
    );
    assert.equal(result.autoStash.restored, true);
  });
}

async function remoteFixture(t) {
  const f = await fixture(t),
    bare = path.join(f.temp, "remote.git"),
    sender = path.join(f.temp, "sender");
  await exec("git", ["init", "--bare", "--initial-branch=main", bare], { env });
  await f.git("remote", "add", "origin", bare);
  await f.git("push", "--set-upstream", "origin", "main");
  await exec("git", ["clone", bare, sender], { env });
  await gitAt(sender, "config", "user.name", "Remote QA");
  await gitAt(sender, "config", "user.email", "remote@example.invalid");
  await gitAt(
    sender,
    "config",
    "core.hooksPath",
    path.join(f.temp, "no-hooks"),
  );
  const remoteCommit = async (file, text) => {
    await fs.mkdir(path.dirname(path.join(sender, file)), { recursive: true });
    await fs.writeFile(path.join(sender, file), text);
    await gitAt(sender, "add", "--force", "--", file);
    await gitAt(sender, "commit", "-m", "remote update");
    await gitAt(sender, "push");
    return (await gitAt(sender, "rev-parse", "HEAD")).trim();
  };
  return { ...f, remoteCommit };
}

for (const rebase of [false, true]) {
  test(`pull ${rebase ? "rebase" : "merge"} fetches real local remote and restores staged partition`, async (t) => {
    const f = await remoteFixture(t);
    const target = await f.remoteCommit("remote.txt", "remote content\n");
    if (rebase) await f.commit("local committed", "main.txt", "main content\n");
    const status = await dirty(f);
    const result = await f.service.action(f.repo, "pull", {
      rebase,
      autoStash: true,
    });
    await restored(f, status);
    await assertRecovery(f, result.autoStash, true);
    assert.equal(
      await fs.readFile(path.join(f.repo, "remote.txt"), "utf8"),
      "remote content\n",
    );
    assert.equal(
      await f.git("merge-base", "--is-ancestor", target, "HEAD"),
      "",
    );
    assert.match(result.command, /git fetch/);
  });
  test(`pull ${rebase ? "rebase" : "merge"} conflicts retain changes and explicit abort restores them`, async (t) => {
    const f = await remoteFixture(t);
    await f.remoteCommit("shared.txt", "remote shared\n");
    const original = await f.commit(
      "local shared",
      "shared.txt",
      "local shared\n",
    );
    const status = await dirty(f);
    await assert.rejects(
      f.service.action(f.repo, "pull", { rebase, autoStash: true }),
      /retained without automatic restoration/,
    );
    const snapshot = await f.service.snapshot(f.repo),
      kind = rebase ? "rebase" : "merge";
    assert.equal(snapshot.operation, kind);
    assert.equal(snapshot.autoStash.awaitingOperation, kind);
    await f.service.action(f.repo, "operation.abort", { kind });
    await restored(f, status);
    assert.equal((await f.git("rev-parse", "HEAD")).trim(), original);
    await assertRecovery(f, snapshot.autoStash, true);
  });
}

for (const operation of [
  "branch.checkout",
  "commit.checkout",
  "merge",
  "rebase",
  "pull",
]) {
  test(`${operation} refuses ignored-file collisions before removing local work into autostash`, async (t) => {
    const f = operation === "pull" ? await remoteFixture(t) : await fixture(t);
    let target;
    if (operation === "pull")
      target = await f.remoteCommit("ignored/private.txt", "remote tracked\n");
    else {
      await f.git("switch", "-c", "side");
      await f.write("ignored/private.txt", "side tracked\n");
      await f.git("add", "--force", "--", "ignored/private.txt");
      target = await f.commit("ignored tracked path");
      await f.git("switch", "main");
    }
    const status = await dirty(f);
    const args =
      operation === "branch.checkout"
        ? { name: "side" }
        : operation === "commit.checkout"
          ? { hash: target }
          : operation === "pull"
            ? { rebase: true }
            : { ref: "side" };
    await assert.rejects(
      f.service.action(f.repo, operation, { ...args, autoStash: true }),
      /overwrite ignored content/,
    );
    await restored(f, status);
    assert.equal(await f.git("stash", "list"), "");
    assert.equal((await f.git("rev-parse", "HEAD")).trim(), f.base);
    assert.equal((await f.service.snapshot(f.repo)).autoStash, undefined);
  });
}

test("rebase also protects ignored obstructions from intermediate replayed commits", async (t) => {
  const f = await fixture(t);
  await f.git("switch", "-c", "side");
  await f.commit("side unrelated", "remote.txt", "remote content\n");
  await f.git("switch", "main");
  await f.write("ignored/private.txt", "temporarily tracked\n");
  await f.git("add", "--force", "--", "ignored/private.txt");
  await f.commit("add ignored path");
  await f.git("rm", "--", "ignored/private.txt");
  await f.commit("delete ignored path");
  const status = await dirty(f);
  await assert.rejects(
    f.service.action(f.repo, "rebase", { ref: "side", autoStash: true }),
    /overwrite ignored content/,
  );
  await restored(f, status);
  assert.equal(await f.git("stash", "list"), "");
});

test("bounded history keeps an old checked-out HEAD visible and explicit focus navigates beyond the first 400 commits without checkout", async (t) => {
  const f = await fixture(t);
  let stream = "";
  const epoch = Math.floor(Date.now() / 1000) + 1;
  for (let i = 1; i <= 425; i++) {
    const message = `Newer history ${i}\n`;
    stream += `commit refs/heads/newer\nmark :${i}\ncommitter History QA <history@example.invalid> ${epoch + i} +0000\ndata ${Buffer.byteLength(message)}\n${message}from ${i === 1 ? f.base : ":" + (i - 1)}\n\n`;
  }
  await new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      ["-C", f.repo, "fast-import", "--quiet"],
      { env },
      (error) => (error ? reject(error) : resolve()),
    );
    child.stdin.on("error", reject);
    child.stdin.end(stream);
  });
  const rawPage = await f.git("log", "--all", "--max-count=400", "--format=%H");
  assert(!rawPage.split("\n").includes(f.base));
  const headView = await f.service.snapshot(f.repo);
  assert.equal(headView.head, f.base);
  assert.equal(headView.branch, "main");
  assert.equal(headView.historyFocus, f.base);
  assert(headView.commits.some((commit) => commit.hash === f.base));
  const newer = (await f.git("rev-parse", "newer")).trim();
  const focused = await f.service.snapshot(f.repo, 400, "newer");
  assert.equal(focused.historyFocus, newer);
  assert.equal(focused.commits.length, 400);
  assert.equal(focused.historyLimited, true);
  assert.equal(focused.commits[0].hash, newer);
  assert.equal((await f.git("rev-parse", "HEAD")).trim(), f.base);
  await assert.rejects(f.service.snapshot(f.repo, 400, "--all"), /invalid/);
  await f.service.action(f.repo, "branch.checkout", { name: "newer" });
  const checked = await f.service.snapshot(f.repo);
  assert.equal(checked.head, newer);
  assert.equal(checked.historyFocus, null);
  assert.equal(checked.commits[0].hash, newer);
  await f.service.action(f.repo, "commit.checkout", { hash: f.base });
  const detached = await f.service.snapshot(f.repo);
  assert.equal(detached.branch, "Detached HEAD");
  assert.equal(detached.historyFocus, f.base);
  assert(detached.commits.some((commit) => commit.hash === f.base));
});
