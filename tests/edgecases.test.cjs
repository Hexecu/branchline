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

async function fixture(t, directory = "repo") {
  const temp = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "branchline-edge-")),
  );
  const repo = path.join(temp, directory),
    service = new GitService();
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  await fs.mkdir(repo);
  const globalConfig = path.join(temp, "empty-gitconfig");
  await fs.writeFile(globalConfig, "");
  const git = async (...args) =>
    (
      await exec("git", ["-C", repo, ...args], {
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: globalConfig,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_TERMINAL_PROMPT: "0",
        },
      })
    ).stdout;
  await git("init", "-b", "main");
  await git("config", "user.name", "Edge Fixture");
  await git("config", "user.email", "edge@example.invalid");
  await git("config", "commit.gpgsign", "false");
  await git("config", "core.autocrlf", "false");
  await git("config", "core.hooksPath", path.join(temp, "empty-hooks"));
  const write = (file, content) => fs.writeFile(path.join(repo, file), content);
  const commit = async () => {
    await service.action(repo, "stage", { files: [] });
    await service.action(repo, "commit", { message: "fixture baseline" });
  };
  return { temp, repo, service, git, write, commit };
}

test("literal filenames survive rename, porcelain, quoted hunks and empty untracked staging", async (t) => {
  const { repo, service, git, write, commit } = await fixture(t);
  // Windows forbids literal tabs, newlines and double quotes in file names.
  // Retain the same rename/literal-path/hunk assertions using legal names there.
  const original =
      process.platform === "win32" ? "before name.txt" : "before\tname.txt",
    renamed =
      process.platform === "win32" ? "after name.txt" : "after\nname.txt",
    quoted =
      process.platform === "win32"
        ? "leaf 🍃 'quote'.txt"
        : 'leaf 🍃 "quote".txt';
  for (const file of [
    original,
    quoted,
    "--literal-option",
    "literal[1].txt",
    "literal1.txt",
  ])
    await write(file, "baseline\n");
  await commit();
  await fs.rename(path.join(repo, original), path.join(repo, renamed));
  await service.action(repo, "stage", { files: [original, renamed] });
  const rename = (await service.snapshot(repo)).files.find(
    (file) => file.path === renamed,
  );
  assert.equal(rename.oldPath, original);
  assert.equal(rename.index, "R");

  await write("--literal-option", "literal flag file\n");
  await write("literal[1].txt", "brackets are literal\n");
  await write("literal1.txt", "must remain unstaged\n");
  await service.action(repo, "stage", {
    files: ["--literal-option", "literal[1].txt"],
  });
  assert.equal(await git("show", ":--literal-option"), "literal flag file\n");
  assert.equal(await git("show", ":literal[1].txt"), "brackets are literal\n");
  assert.equal(await git("show", ":literal1.txt"), "baseline\n");

  await write(quoted, "baseline\nnew line\n");
  await service.action(repo, "hunk.stage", {
    patch: await service.diff(repo, { file: quoted }),
  });
  assert.equal(await git("show", ":" + quoted), "baseline\nnew line\n");
  for (const [file, content] of [
    [
      process.platform === "win32"
        ? "fresh leaf 🍃 'note'.txt"
        : 'fresh\nleaf 🍃\t"note".txt',
      "one\ntwo",
    ],
    ["empty.txt", ""],
  ]) {
    await write(file, content);
    await service.action(repo, "hunk.stage", {
      patch: await service.diff(repo, { file }),
    });
    assert.equal(await git("show", ":" + file), content);
    assert.equal(await fs.readFile(path.join(repo, file), "utf8"), content);
  }
});

test(
  "repository names retain trailing whitespace instead of trimming filesystem paths",
  {
    skip:
      process.platform === "win32" &&
      "Windows filesystems do not support trailing whitespace/newlines in directory names",
  },
  async (t) => {
    const { repo, service, write, commit } = await fixture(t, "workspace \n");
    await write("notes.txt", "exact path\n");
    await commit();
    assert.equal((await service.snapshot(repo)).path, repo);
    assert.equal(await service.file(repo, "notes.txt", "HEAD"), "exact path\n");
  },
);

test("shell-shaped references stay literal while option and traversal inputs are refused", async (t) => {
  const { temp, repo, service, git, write, commit } = await fixture(t);
  await write("notes.txt", "baseline\n");
  await commit();
  const name = "feature/$(touch${IFS}SHELL_SENTINEL)";
  await service.action(repo, "branch.create", { name });
  assert.equal(
    (
      await git(
        "for-each-ref",
        "--format=%(refname:short)",
        "refs/heads/" + name,
      )
    ).trim(),
    name,
  );
  await assert.rejects(fs.access(path.join(repo, "SHELL_SENTINEL")));
  await assert.rejects(
    service.action(repo, "branch.create", { name: "--orphan=unexpected" }),
    /invalid/,
  );
  await assert.rejects(
    service.action(repo, "remote.add", { name: "--config", url: repo }),
    /invalid/,
  );
  await assert.rejects(
    service.clone("--upload-pack=unexpected", path.join(temp, "clone")),
    /invalid/,
  );
  await assert.rejects(
    service.clone("ext::sh -c touch SENTINEL", path.join(temp, "clone")),
    /ext Git transport/,
  );

  const outside = path.join(temp, "outside");
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "secret.txt"), "keep this content\n");
  await fs.symlink(
    outside,
    path.join(repo, "escape"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    service.action(repo, "stage", { files: ["escape/secret.txt"] }),
    /outside/,
  );
  await assert.rejects(
    service.action(repo, "discard", { files: ["../outside/secret.txt"] }),
    /inside/,
  );
  assert.equal(
    await fs.readFile(path.join(outside, "secret.txt"), "utf8"),
    "keep this content\n",
  );
});
