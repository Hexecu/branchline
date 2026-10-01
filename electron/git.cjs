"use strict";

const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const runFile = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;
const pathOutput = (text) => (text.endsWith("\n") ? text.slice(0, -1) : text);
function quoteGitPath(input) {
  let output = '"';
  for (const char of input) {
    if (char === '"' || char === "\\") output += "\\" + char;
    else if (char.codePointAt(0) < 32 || char.codePointAt(0) === 127)
      output += "\\" + char.codePointAt(0).toString(8).padStart(3, "0");
    else output += char;
  }
  return output + '"';
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}
function value(input, label = "Value") {
  if (
    typeof input !== "string" ||
    !input.length ||
    input.length > 8192 ||
    /[\x00-\x1f\x7f]/.test(input) ||
    input.startsWith("-")
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return input;
}
function safeURL(input) {
  value(input, "Repository URL");
  if (/^ext::/i.test(input))
    throw new Error("The ext Git transport is not allowed.");
  return input;
}
function cleanLog(input) {
  return String(input || "")
    .replace(/(https?:\/\/)([^\s/@]+)@/gi, "$1[credentials]@")
    .replace(
      /([?&](?:token|access_token|password|key)=)[^\s&]+/gi,
      "$1[redacted]",
    );
}
function commandString(args) {
  return `git ${args.map((a) => (/\s/.test(a) ? JSON.stringify(cleanLog(a)) : cleanLog(a))).join(" ")}`;
}
function parseCommits(text) {
  return text
    .split("\x1e")
    .filter((x) => x.trim())
    .map((record) => {
      const [hash, parents, author, email, date, subject, refs, ...body] =
        record.replace(/^\n/, "").split("\x1f");
      return {
        hash,
        shortHash: hash.slice(0, 8),
        parents: parents ? parents.split(" ") : [],
        author,
        email,
        date,
        subject,
        refs: refs
          ? refs
              .split(", ")
              .filter((ref) => ref && !ref.includes("refs/branchline/"))
          : [],
        body: body.join("\x1f").replace(/\n$/, ""),
      };
    });
}
const LOG_FORMAT = "%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%D%x1f%b";
function parseStatus(text) {
  const parts = text.split("\0");
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry) continue;
    const index = entry[0],
      worktree = entry[1],
      filename = entry.slice(3);
    const oldPath =
      index === "R" || index === "C" || worktree === "R" || worktree === "C"
        ? parts[++i]
        : undefined;
    const conflict = ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(
      index + worktree,
    );
    files.push({
      path: filename,
      ...(oldPath ? { oldPath } : {}),
      index,
      worktree,
      staged: index !== " " && index !== "?" && index !== "!",
      unstaged: worktree !== " " && worktree !== "!",
      conflict,
    });
  }
  return files;
}
function parseWorktrees(text) {
  const rows = [],
    current = {};
  function push() {
    if (current.path)
      rows.push({
        path: current.path,
        head: current.head || "",
        branch: current.branch || "",
        bare: !!current.bare,
        locked: !!current.locked,
      });
    for (const k of Object.keys(current)) delete current[k];
  }
  for (const line of text.split("\0")) {
    if (!line) {
      push();
      continue;
    }
    if (line.startsWith("worktree ")) current.path = line.slice(9);
    else if (line.startsWith("HEAD ")) current.head = line.slice(5);
    else if (line.startsWith("branch "))
      current.branch = line.slice(7).replace(/^refs\/heads\//, "");
    else if (line === "bare") current.bare = true;
    else if (line.startsWith("locked")) current.locked = true;
  }
  push();
  return rows;
}
function decodeGitPath(str) {
  if (!str.startsWith('"')) return str.split("\t")[0];
  const quoted = /^"((?:\\.|[^"\\])*)"/.exec(str);
  if (!quoted) throw new Error("Malformed quoted patch path.");
  str = quoted[0];
  const bytes = [];
  for (let i = 1; i < str.length - 1; i++) {
    if (str[i] !== "\\") {
      const character = String.fromCodePoint(str.codePointAt(i));
      bytes.push(...Buffer.from(character));
      i += character.length - 1;
      continue;
    }
    const escaped = str[++i];
    if (/[0-7]/.test(escaped)) {
      let octal = escaped;
      for (let n = 0; n < 2 && /[0-7]/.test(str[i + 1]); n++) octal += str[++i];
      bytes.push(parseInt(octal, 8));
    } else
      bytes.push(
        { t: 9, n: 10, r: 13, b: 8, f: 12, v: 11, a: 7, "\\": 92, '"': 34 }[
          escaped
        ] ?? escaped.charCodeAt(0),
      );
  }
  return Buffer.from(bytes).toString("utf8");
}

class GitService {
  constructor(onActivity) {
    this.onActivity = onActivity;
    this.locks = new Map();
  }

  async git(repo, args, options = {}) {
    const actual = [
      "-c",
      "core.quotepath=false",
      "-c",
      "protocol.ext.allow=never",
      ...(repo ? ["-C", repo] : []),
      ...args,
    ];
    const { includeStderr, ...execOptions } = options;
    try {
      const result = await runFile("git", actual, {
        encoding: "utf8",
        maxBuffer: MAX_BUFFER,
        timeout: options.timeout ?? 120000,
        env: {
          ...process.env,
          GIT_PAGER: "cat",
          GIT_TERMINAL_PROMPT: "0",
          GIT_LITERAL_PATHSPECS: args[0] === "stash" ? "0" : "1",
          LC_ALL: "C",
        },
        ...execOptions,
      });
      return includeStderr
        ? cleanLog(result.stdout + result.stderr)
        : result.stdout;
    } catch (error) {
      const message = cleanLog(
        `${error.stderr || ""}${error.stdout || ""}`.trim() || error.message,
      );
      const wrapped = new Error(message);
      wrapped.code = error.code;
      wrapped.command = commandString(args);
      throw wrapped;
    }
  }
  async gitInput(repo, args, input) {
    // execFile's API has no stdin input option. Write to the child's stdin directly.
    return new Promise((resolve, reject) => {
      const actual = [
        "-c",
        "core.quotepath=false",
        "-c",
        "protocol.ext.allow=never",
        "-C",
        repo,
        ...args,
      ];
      const child = execFile(
        "git",
        actual,
        {
          encoding: "utf8",
          maxBuffer: MAX_BUFFER,
          timeout: 120000,
          env: {
            ...process.env,
            GIT_PAGER: "cat",
            GIT_TERMINAL_PROMPT: "0",
            GIT_LITERAL_PATHSPECS: "1",
            LC_ALL: "C",
          },
        },
        (error, stdout, stderr) => {
          if (error) {
            const err = new Error(
              cleanLog((stderr + stdout).trim() || error.message),
            );
            err.command = commandString(args);
            reject(err);
          } else resolve(stdout);
        },
      );
      child.stdin.on("error", () => {});
      child.stdin.end(input);
    });
  }
  async optional(repo, args, fallback = "") {
    try {
      return await this.git(repo, args);
    } catch {
      return fallback;
    }
  }
  async root(input) {
    if (typeof input !== "string" || !input || input.includes("\0"))
      throw new Error("Select a repository directory.");
    const resolved = await fs.realpath(path.resolve(input));
    const top = pathOutput(
      await this.git(resolved, ["rev-parse", "--show-toplevel"]),
    );
    return fs.realpath(top);
  }
  async metadata(repo) {
    const [gitdir, common] = await Promise.all([
      this.git(repo, ["rev-parse", "--absolute-git-dir"]),
      this.git(repo, [
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ]),
    ]);
    return { gitdir: pathOutput(gitdir), common: pathOutput(common) };
  }
  async relative(repo, input) {
    if (
      typeof input !== "string" ||
      !input ||
      input.includes("\0") ||
      path.isAbsolute(input) ||
      /^[a-z]:/i.test(input) ||
      input.split(/[\\/]/).includes("..") ||
      input.split(/[\\/]/).includes(".git")
    )
      throw new Error("File path must stay inside the repository.");
    const target = path.resolve(repo, input);
    if (!inside(repo, target) || target === repo)
      throw new Error("File path must stay inside the repository.");
    let ancestor = target;
    for (;;) {
      try {
        const real = await fs.realpath(ancestor);
        if (!inside(repo, real))
          throw new Error("File path resolves outside the repository.");
        break;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        const parent = path.dirname(ancestor);
        if (parent === ancestor) throw error;
        ancestor = parent;
      }
    }
    return path.relative(repo, target).split(path.sep).join("/");
  }
  async resolve(repo, ref, type = "commit") {
    value(ref, "Git reference");
    return (
      await this.git(repo, [
        "rev-parse",
        "--verify",
        "--end-of-options",
        `${ref}^{${type}}`,
      ])
    ).trim();
  }
  async branchName(repo, name) {
    value(name, "Branch name");
    await this.git(repo, ["check-ref-format", "--branch", name]);
    return name;
  }
  async refName(repo, name, kind = "tags") {
    value(name, "Reference name");
    await this.git(repo, ["check-ref-format", `refs/${kind}/${name}`]);
    return name;
  }
  async queue(key, fn) {
    const previous = this.locks.get(key) || Promise.resolve();
    const task = previous.catch(() => {}).then(fn);
    this.locks.set(key, task);
    try {
      return await task;
    } finally {
      if (this.locks.get(key) === task) this.locks.delete(key);
    }
  }
  async operation(repo) {
    const { gitdir } = await this.metadata(repo);
    for (const [file, name] of [
      ["rebase-merge", "rebase"],
      ["rebase-apply", "rebase"],
      ["MERGE_HEAD", "merge"],
      ["CHERRY_PICK_HEAD", "cherry-pick"],
      ["REVERT_HEAD", "revert"],
    ]) {
      try {
        await fs.access(path.join(gitdir, file));
        return name;
      } catch {}
    }
    return null;
  }

  async snapshot(input, limit = 400, focusRef) {
    const repo = await this.root(input);
    const count = Math.max(
      1,
      Math.min(
        5000,
        Number.isFinite(Number(limit)) ? Math.trunc(Number(limit)) : 400,
      ),
    );
    const focus =
      focusRef === undefined ? null : await this.resolve(repo, focusRef);
    const results = await Promise.all([
      this.git(repo, [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
      ]),
      this.optional(repo, [
        "log",
        ...(focus ? [focus] : ["--exclude=refs/branchline/*", "--all"]),
        `--max-count=${count + 1}`,
        "--date-order",
        `--format=${LOG_FORMAT}`,
      ]),
      this.git(repo, [
        "for-each-ref",
        "--format=%(refname)%00%(objectname)%00%(HEAD)%00%(upstream:short)%00%(upstream:track)%00",
        "refs/heads",
        "refs/remotes",
      ]),
      this.git(repo, [
        "for-each-ref",
        "--format=%(refname:short)%00%(objectname)%00%(*objectname)%00%(subject)%00",
        "refs/tags",
      ]),
      this.optional(repo, [
        "stash",
        "list",
        "--format=%gd%x00%H%x00%gs%x00%aI",
      ]),
      this.git(repo, ["remote", "-v"]),
      this.git(repo, ["worktree", "list", "--porcelain", "-z"]),
      this.optional(repo, [
        "reflog",
        "--max-count=100",
        "--date=iso-strict",
        "--format=%H%x00%gD%x00%gs%x00%aI",
      ]),
      this.optional(repo, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
      this.optional(repo, ["rev-parse", "--verify", "HEAD"]),
      this.optional(repo, [
        "rev-parse",
        "--abbrev-ref",
        "--symbolic-full-name",
        "@{upstream}",
      ]),
      this.git(null, ["--version"]),
      this.operation(repo),
      this.pendingAutoStash(repo),
    ]);
    const [
      status,
      log,
      branchText,
      tagText,
      stashText,
      remoteText,
      worktreeText,
      reflogText,
      branch,
      head,
      upstream,
      gitVersion,
      operation,
      autoStash,
    ] = results;
    const branches = branchText
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [ref, hash, current, tracking, track] = line.split("\0");
        return {
          name: ref.replace(/^refs\/(heads|remotes)\//, ""),
          hash,
          current: current === "*",
          remote: ref.startsWith("refs/remotes/"),
          upstream: tracking,
          ahead: Number(/ahead (\d+)/.exec(track)?.[1] || 0),
          behind: Number(/behind (\d+)/.exec(track)?.[1] || 0),
        };
      });
    const tags = tagText
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, hash, peeled, subject] = line.split("\0");
        return { name, hash: peeled || hash, subject };
      });
    const stashes = stashText
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [ref, hash, subject, date] = line.split("\0");
        return { ref, hash, subject, date };
      });
    const remotesMap = new Map();
    for (const line of remoteText.split("\n")) {
      const match = /^(\S+)\s+(.*?)\s+\((fetch|push)\)$/.exec(line);
      if (!match) continue;
      const remote = remotesMap.get(match[1]) || {
        name: match[1],
        fetch: "",
        push: "",
      };
      remote[match[3]] = cleanLog(match[2]);
      remotesMap.set(match[1], remote);
    }
    const reflog = reflogText
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, ref, subject, authoredDate] = line.split("\0");
        return {
          hash,
          ref,
          subject,
          date: /@\{(.+)\}$/.exec(ref)?.[1] || authoredDate,
        };
      });
    const current = branches.find((b) => b.current);
    let commits = parseCommits(log),
      historyFocus = focus;
    if (
      !focus &&
      head.trim() &&
      !commits.slice(0, count).some((commit) => commit.hash === head.trim())
    ) {
      historyFocus = head.trim();
      commits = parseCommits(
        await this.git(repo, [
          "log",
          historyFocus,
          `--max-count=${count + 1}`,
          "--date-order",
          `--format=${LOG_FORMAT}`,
        ]),
      );
    }
    const historyLimited = commits.length > count;
    return {
      path: repo,
      name: path.basename(repo),
      branch:
        branch.trim() || (head.trim() ? "Detached HEAD" : "Unborn branch"),
      head: head.trim(),
      upstream: upstream.trim(),
      ahead: current?.ahead || 0,
      behind: current?.behind || 0,
      files: parseStatus(status),
      commits: commits.slice(0, count),
      branches,
      tags,
      stashes,
      remotes: [...remotesMap.values()],
      worktrees: parseWorktrees(worktreeText),
      reflog,
      operation,
      gitVersion: gitVersion.trim(),
      historyFocus,
      historyLimited,
      ...(autoStash ? { autoStash } : {}),
    };
  }

  async diff(input, options = {}) {
    const repo = await this.root(input);
    const args = ["diff", "--no-ext-diff", "--no-color", "--find-renames"];
    if (options.commit) {
      const hash = await this.resolve(repo, options.commit);
      args.splice(0, 1, "show");
      args.push("--first-parent", "--format=", hash);
    } else if (options.from || options.to) {
      if (options.from) args.push(await this.resolve(repo, options.from));
      if (options.to) args.push(await this.resolve(repo, options.to));
    } else if (options.staged) args.push("--cached");
    if (options.file) args.push("--", await this.relative(repo, options.file));
    const output = await this.git(repo, args);
    if (
      !output &&
      options.file &&
      !options.staged &&
      !options.commit &&
      !options.from &&
      !options.to
    ) {
      const file = await this.relative(repo, options.file);
      const tracked = await this.optional(repo, [
        "ls-files",
        "--error-unmatch",
        "--",
        file,
      ]);
      if (!tracked) {
        try {
          const data = await fs.readFile(path.join(repo, file), "utf8");
          if (data.includes("\0")) return `Binary untracked file: ${file}\n`;
          const lines = data.split("\n"),
            finalNewline = data.endsWith("\n");
          if (finalNewline) lines.pop();
          const quoted = (prefix) => quoteGitPath(prefix + file);
          const header = `diff --git ${quoted("a/")} ${quoted("b/")}\nnew file mode 100644\n`;
          if (!data) return header + "index 0000000..e69de29\n";
          return `${header}--- /dev/null\n+++ ${quoted("b/")}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => "+" + line).join("\n")}\n${!finalNewline ? "\\ No newline at end of file\n" : ""}`;
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
    }
    return output;
  }
  async commitDetails(input, ref) {
    const repo = await this.root(input),
      hash = await this.resolve(repo, ref);
    const [log, names, nums, diff] = await Promise.all([
      this.git(repo, ["show", "-s", `--format=${LOG_FORMAT}`, hash]),
      this.git(repo, [
        "diff-tree",
        "--root",
        "--no-commit-id",
        "-r",
        "-m",
        "--first-parent",
        "--name-status",
        "-z",
        "--find-renames",
        hash,
      ]),
      this.git(repo, [
        "diff-tree",
        "--root",
        "--no-commit-id",
        "-r",
        "-m",
        "--first-parent",
        "--numstat",
        "-z",
        "--find-renames",
        hash,
      ]),
      this.git(repo, [
        "show",
        "--no-ext-diff",
        "--no-color",
        "--first-parent",
        "--format=",
        "--find-renames",
        hash,
      ]),
    ]);
    const numberMap = new Map(),
      pieces = nums.split("\0");
    for (let i = 0; i < pieces.length; i++) {
      if (!pieces[i]) continue;
      const [add, del, ...filename] = pieces[i].split("\t");
      let file = filename.join("\t");
      if (!file) {
        i++;
        file = pieces[++i];
      }
      numberMap.set(file, {
        additions: add === "-" ? 0 : Number(add),
        deletions: del === "-" ? 0 : Number(del),
      });
    }
    const files = [],
      namePieces = names.split("\0");
    for (let i = 0; i < namePieces.length; i++) {
      const status = namePieces[i];
      if (!status) continue;
      let file = namePieces[++i];
      if (/^[RC]/.test(status)) file = namePieces[++i];
      files.push({
        path: file,
        status,
        ...(numberMap.get(file) || { additions: 0, deletions: 0 }),
      });
    }
    return { commit: parseCommits(log)[0], files, diff };
  }
  async file(input, filename, ref) {
    const repo = await this.root(input),
      file = await this.relative(repo, filename);
    const output = ref
      ? await this.git(repo, [
          "show",
          `${await this.resolve(repo, ref)}:${file}`,
        ])
      : await fs.readFile(path.join(repo, file), "utf8");
    if (output.includes("\0"))
      throw new Error("This is a binary file and cannot be displayed as text.");
    return output;
  }
  async blame(input, filename, ref) {
    const repo = await this.root(input),
      file = await this.relative(repo, filename);
    return this.git(repo, [
      "blame",
      "--date=iso",
      ...(ref ? [await this.resolve(repo, ref)] : []),
      "--",
      file,
    ]);
  }
  async conflictVersions(input, filename) {
    const repo = await this.root(input),
      file = await this.relative(repo, filename);
    const entries = (
      await this.git(repo, ["ls-files", "--stage", "-z", "--", file])
    ).split("\0");
    const stages = new Set(
      entries
        .map((entry) => /^\d+ [a-f0-9]+ (\d)\t/.exec(entry)?.[1])
        .filter(Boolean),
    );
    if (!["1", "2", "3"].some((stage) => stages.has(stage)))
      throw new Error("This file has no unresolved conflict.");
    let workingPresent = true;
    const [base, ours, theirs, working] = await Promise.all([
      stages.has("1") ? this.git(repo, ["show", ":1:" + file]) : "",
      stages.has("2") ? this.git(repo, ["show", ":2:" + file]) : "",
      stages.has("3") ? this.git(repo, ["show", ":3:" + file]) : "",
      this.file(repo, file).catch((error) => {
        if (error.code !== "ENOENT") throw error;
        workingPresent = false;
        return "";
      }),
    ]);
    if ([base, ours, theirs, working].some((text) => text.includes("\0")))
      throw new Error(
        "Resolve binary conflicts by choosing a complete version.",
      );
    return {
      base,
      ours,
      theirs,
      working,
      present: {
        base: stages.has("1"),
        ours: stages.has("2"),
        theirs: stages.has("3"),
        working: workingPresent,
      },
    };
  }
  async history(input, filename) {
    const repo = await this.root(input),
      file = await this.relative(repo, filename);
    return parseCommits(
      await this.optional(repo, [
        "log",
        "--follow",
        "--max-count=1000",
        `--format=${LOG_FORMAT}`,
        "--",
        file,
      ]),
    );
  }
  async rebasePlan(input, base) {
    const repo = await this.root(input),
      hash = await this.resolve(repo, base);
    await this.git(repo, ["merge-base", "--is-ancestor", hash, "HEAD"]);
    const merges = await this.git(repo, [
      "rev-list",
      "--merges",
      `${hash}..HEAD`,
    ]);
    if (merges.trim())
      throw new Error(
        "Interactive rebase currently requires a linear history. Select a base after the last merge.",
      );
    return parseCommits(
      await this.git(repo, [
        "log",
        "--reverse",
        "--topo-order",
        `--format=${LOG_FORMAT}`,
        `${hash}..HEAD`,
      ]),
    );
  }
  async interactiveRebase(repo, args, calls, outputs) {
    if ((await this.git(repo, ["status", "--porcelain=v1"])).trim())
      throw new Error("Commit or stash changes before interactive rebase.");
    if (await this.operation(repo))
      throw new Error("Complete or abort the current operation first.");
    const base = await this.resolve(repo, args.base),
      commits = await this.rebasePlan(repo, base);
    if (
      !Array.isArray(args.plan) ||
      !commits.length ||
      args.plan.length !== commits.length
    )
      throw new Error(
        "The rebase plan must contain every commit after the base exactly once.",
      );
    const allowed = new Set(commits.map((c) => c.hash)),
      seen = new Set();
    for (const row of args.plan) {
      if (
        !row ||
        !allowed.has(row.hash) ||
        seen.has(row.hash) ||
        !["pick", "reword", "squash", "fixup", "drop"].includes(row.action)
      )
        throw new Error(
          "The rebase plan has a missing, duplicate, invalid, or foreign commit.",
        );
      if (
        row.message !== undefined &&
        (typeof row.message !== "string" ||
          !row.message.trim() ||
          row.message.includes("\0"))
      )
        throw new Error("Reword messages must be non-empty text.");
      seen.add(row.hash);
    }
    const first = args.plan.find((row) => row.action !== "drop");
    if (first && ["squash", "fixup"].includes(first.action))
      throw new Error("The first retained commit must use pick or reword.");
    const backup = await this.backupRef(repo),
      { gitdir } = await this.metadata(repo);
    const directory = path.join(gitdir, "branchline", "rebase", randomUUID());
    await fs.mkdir(directory, { recursive: true });
    const todo =
      args.plan.map((row) => `${row.action} ${row.hash}`).join("\n") + "\n";
    await fs.writeFile(path.join(directory, "todo"), todo);
    await fs.writeFile(
      path.join(directory, "plan.json"),
      JSON.stringify(args.plan),
    );
    await fs.writeFile(path.join(directory, "gitdir"), gitdir);
    const script = path.join(directory, "editor.cjs");
    await fs.writeFile(
      script,
      `const fs=require('node:fs');const path=require('node:path');const dir=__dirname;const [mode,target]=process.argv.slice(2);if(mode==='sequence'){fs.copyFileSync(path.join(dir,'todo'),target);}else{const plan=JSON.parse(fs.readFileSync(path.join(dir,'plan.json'),'utf8'));const gitdir=fs.readFileSync(path.join(dir,'gitdir'),'utf8');const done=fs.readFileSync(path.join(gitdir,'rebase-merge','done'),'utf8').trim().split('\\n').map(line=>line.split(' '));let message=null;const last=done.at(-1);if(last&&last[0]==='reword'){message=plan.find(row=>row.hash===last[1])?.message;}else if(last&&['squash','fixup'].includes(last[0])){for(let i=done.length-1;i>=0&&['squash','fixup'].includes(done[i][0]);i--){if(done[i][0]==='squash'){message=plan.find(row=>row.hash===done[i][1])?.message;if(message)break;}}}if(message)fs.writeFileSync(target,message+'\\n');}`,
    );
    const quote = (text) => "'" + text.replace(/'/g, "'\\''") + "'";
    const editor = `ELECTRON_RUN_AS_NODE=1 ${quote(process.execPath)} ${quote(script)}`;
    const state = path.join(gitdir, "branchline", "rebase", "current.json");
    await fs.writeFile(state, JSON.stringify({ directory, editor }));
    const command = ["rebase", "--interactive", base];
    calls.push(commandString(command));
    try {
      const result = await this.git(repo, command, {
        includeStderr: true,
        env: {
          ...process.env,
          GIT_SEQUENCE_EDITOR: `${editor} sequence`,
          GIT_EDITOR: `${editor} message`,
          GIT_TERMINAL_PROMPT: "0",
          GIT_PAGER: "cat",
          LC_ALL: "C",
        },
      });
      outputs.push(result.trim(), `Recovery ref: ${backup}`);
    } catch (error) {
      error.message += `\nRecovery ref: ${backup}`;
      throw error;
    }
    // Keep editor scripts while an operation is active, so Continue can finish it.
    if (!(await this.operation(repo))) {
      await fs.rm(directory, { recursive: true, force: true });
      await fs.rm(state, { force: true });
    }
  }

  async backupRef(repo, ref = "HEAD") {
    const hash = await this.optional(repo, [
      "rev-parse",
      "--verify",
      "--end-of-options",
      ref,
    ]);
    if (!hash.trim()) return null;
    const backup = `refs/branchline/backups/${Date.now()}-${randomUUID().slice(0, 8)}`;
    await this.git(repo, ["update-ref", backup, hash.trim()]);
    return backup;
  }
  async journalPath(repo) {
    const { gitdir } = await this.metadata(repo);
    const folder = path.join(gitdir, "branchline");
    await fs.mkdir(folder, { recursive: true });
    return path.join(folder, "history.json");
  }
  async journal(repo) {
    try {
      return JSON.parse(
        await fs.readFile(await this.journalPath(repo), "utf8"),
      );
    } catch {
      return { undo: [], redo: [] };
    }
  }
  async writeJournal(repo, data) {
    const target = await this.journalPath(repo),
      temporary = `${target}.${randomUUID()}`;
    await fs.writeFile(temporary, JSON.stringify(data, null, 2));
    await fs.rename(temporary, target);
  }
  async protectWorking(repo, message) {
    if (!(await this.git(repo, ["status", "--porcelain=v1"])).trim()) return "";
    await this.git(repo, [
      "stash",
      "push",
      "--include-untracked",
      "-m",
      `Branchline recovery: ${message}`,
    ]);
    return (
      await this.git(repo, ["rev-parse", "--verify", "refs/stash"])
    ).trim();
  }
  async captureIndex(repo) {
    const { gitdir } = await this.metadata(repo),
      id = randomUUID(),
      directory = path.join(gitdir, "branchline", "indexes");
    await fs.mkdir(directory, { recursive: true });
    const target = path.join(directory, id);
    await fs.copyFile(path.join(gitdir, "index"), target).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    // Keep staged-only blobs reachable even if the index snapshot is the sole reference.
    const stash = (
      await this.optional(repo, [
        "stash",
        "create",
        "Branchline index recovery",
      ])
    ).trim();
    const ref = stash ? await this.backupRef(repo, stash) : "";
    return { id, ref };
  }
  async restoreIndex(repo, snapshot) {
    if (!snapshot || !/^[a-f\d-]{36}$/.test(snapshot.id))
      throw new Error("The reset index recovery snapshot is unavailable.");
    const { gitdir } = await this.metadata(repo),
      source = path.join(gitdir, "branchline", "indexes", snapshot.id),
      target = path.join(gitdir, "index");
    const temporary = `${target}.branchline-${randomUUID()}`;
    await fs.copyFile(source, temporary);
    await fs.rename(temporary, target);
  }
  async guardIgnoredReset(repo, target, label = "Hard reset", replay = false) {
    const [ignoredText, trackedText] = await Promise.all([
      this.git(repo, [
        "ls-files",
        "--others",
        "--ignored",
        "--exclude-standard",
        "-z",
      ]),
      this.git(repo, ["ls-tree", "-r", "--name-only", "-z", target]),
    ]);
    const ignored = ignoredText.split("\0").filter(Boolean),
      tracked = trackedText.split("\0").filter(Boolean);
    if (replay && ignored.length) {
      // Rebase can check out files from an intermediate replayed commit, even
      // when those paths are absent from both final trees.
      const touched = await this.git(repo, [
        "log",
        "--format=",
        "--name-only",
        "-z",
        `${target}..HEAD`,
      ]);
      tracked.push(...touched.split("\0").filter(Boolean));
    }
    const obstacle = ignored.find((file) =>
      tracked.some(
        (next) =>
          file === next ||
          file.startsWith(next + "/") ||
          next.startsWith(file + "/"),
      ),
    );
    if (obstacle)
      throw new Error(
        `${label} would overwrite ignored content: ${obstacle}. Move this file outside the repository first.`,
      );
  }
  async autoStashPath(repo) {
    const { gitdir } = await this.metadata(repo);
    return path.join(gitdir, "branchline", "auto-stash.json");
  }
  async pendingAutoStash(repo) {
    try {
      const state = JSON.parse(
        await fs.readFile(await this.autoStashPath(repo), "utf8"),
      );
      if (
        !state ||
        !/^[a-f\d]{40,64}$/.test(state.hash) ||
        !/^refs\/branchline\/backups\/[\d]+-[a-f\d]{8}$/.test(state.ref)
      )
        return null;
      return state;
    } catch {
      return null;
    }
  }
  async writeAutoStash(repo, state) {
    const target = await this.autoStashPath(repo);
    if (!state) {
      await fs.rm(target, { force: true });
      return;
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}`;
    await fs.writeFile(temporary, JSON.stringify(state, null, 2));
    await fs.rename(temporary, target);
  }
  autoStashNotice(state) {
    return `Autostash ${state.restored ? "restored" : "retained without automatic restoration"}: ${state.hash}\nAutostash recovery ref: ${state.ref}\n${state.restored ? "The original staged, unstaged and untracked changes were restored. The stash entry and recovery ref remain available; remove the entry explicitly when no longer needed." : "Finish or abort the Git operation, then restore from the stash list with Restore index enabled, or run: git stash apply --index " + state.ref}`;
  }
  async restoreAutoStash(repo, state, run, outputs) {
    // Never apply on top of an unfinished merge/rebase or unresolved index.
    if (await this.operation(repo)) {
      state.awaitingOperation = await this.operation(repo);
      await this.writeAutoStash(repo, state);
      outputs.push(this.autoStashNotice(state));
      return state;
    }
    try {
      const unmerged = await this.git(repo, ["ls-files", "--unmerged", "-z"]);
      if (unmerged)
        throw new Error(
          "Resolve the existing index conflicts before restoring the autostash.",
        );
      await this.guardIgnoredReset(repo, state.hash, "Autostash restoration");
      const untracked = await this.optional(repo, [
        "rev-parse",
        "--verify",
        `${state.hash}^3`,
      ]);
      if (untracked.trim())
        await this.guardIgnoredReset(
          repo,
          untracked.trim(),
          "Autostash restoration",
        );
      await run(["stash", "apply", "--index", state.hash]);
    } catch (error) {
      state.conflict = true;
      state.restored = false;
      state.awaitingOperation = null;
      await this.writeAutoStash(repo, state);
      error.message = `Autostash restoration conflict. The Git operation completed, but local changes could not be fully restored; the stash and recovery ref are preserved.\n${error.message}`;
      throw error;
    }
    state.restored = true;
    state.conflict = false;
    state.awaitingOperation = null;
    await this.writeAutoStash(repo, null);
    // Another Git process can change stash ordinals between inspection and drop.
    // Keep the entry instead of risking removal of another process's changes.
    outputs.push(this.autoStashNotice(state));
    return state;
  }
  async validatePatch(repo, patch) {
    if (typeof patch !== "string" || !patch.trim() || patch.length > MAX_BUFFER)
      throw new Error("A non-empty patch is required.");
    let paths = 0;
    for (const line of patch.split("\n")) {
      if (line.startsWith("diff --git ")) {
        const match =
          /^diff --git ("(?:\\.|[^"\\])*"|\S+) ("(?:\\.|[^"\\])*"|\S+)$/.exec(
            line,
          );
        if (match)
          for (const raw of match.slice(1)) {
            const filename = decodeGitPath(raw);
            if (!/^[ab]\//.test(filename))
              throw new Error("Patch paths must use a/ and b/ prefixes.");
            await this.relative(repo, filename.slice(2));
            paths++;
          }
      }
      if (line.startsWith("--- ") || line.startsWith("+++ ")) {
        const filename = decodeGitPath(line.slice(4));
        if (filename === "/dev/null") continue;
        if (!/^[ab]\//.test(filename))
          throw new Error("Patch paths must use a/ and b/ prefixes.");
        await this.relative(repo, filename.slice(2));
        paths++;
      }
      if (/^(rename|copy) (from|to) /.test(line)) {
        await this.relative(
          repo,
          decodeGitPath(line.replace(/^(rename|copy) (from|to) /, "")),
        );
        paths++;
      }
      if (
        /^(old|new) mode 120000/.test(line) ||
        line === "new file mode 120000"
      )
        throw new Error("Apply symbolic-link changes as whole files.");
    }
    if (!paths) throw new Error("The patch does not contain file headers.");
  }
  async discard(repo, filenames) {
    if (!Array.isArray(filenames) || !filenames.length)
      throw new Error("Select files to discard.");
    const files = await Promise.all(
        filenames.map((f) => this.relative(repo, f)),
      ),
      { gitdir } = await this.metadata(repo);
    const id = `${Date.now()}-${randomUUID().slice(0, 8)}`,
      folder = path.join(gitdir, "branchline", "backups", id),
      records = [];
    await fs.mkdir(folder, { recursive: true });
    for (const file of files) {
      const target = path.join(repo, file),
        saved = path.join(folder, "files", file);
      const tracked = !!(await this.optional(repo, [
        "ls-files",
        "--error-unmatch",
        "--",
        file,
      ]));
      const exists = await fs.lstat(target).then(
        () => true,
        (error) => {
          if (error.code === "ENOENT") return false;
          throw error;
        },
      );
      if (exists) {
        await fs.mkdir(path.dirname(saved), { recursive: true });
        await fs.cp(target, saved, { recursive: true, dereference: false });
      }
      records.push({ file, tracked, exists });
    }
    await fs.writeFile(
      path.join(folder, "manifest.json"),
      JSON.stringify({ repo, records }, null, 2),
    );
    for (const record of records) {
      if (record.tracked)
        await this.git(repo, ["restore", "--worktree", "--", record.file]);
      else if (record.exists)
        await fs.rm(path.join(repo, record.file), {
          force: true,
          recursive: true,
        });
    }
    return `Discarded ${files.length} file(s). Recovery backup: ${folder}\nUse discard.restore with backup "${id}" to recover.`;
  }
  async restoreDiscard(repo, id) {
    if (typeof id !== "string" || !/^\d+-[a-f\d]{8}$/.test(id))
      throw new Error("Invalid recovery backup identifier.");
    const { gitdir } = await this.metadata(repo),
      folder = path.join(gitdir, "branchline", "backups", id);
    const manifest = JSON.parse(
      await fs.readFile(path.join(folder, "manifest.json"), "utf8"),
    );
    if (manifest.repo !== repo || !Array.isArray(manifest.records))
      throw new Error("This recovery backup belongs to another repository.");
    // Save current versions first so restoration is itself recoverable.
    const current = await this.discard(
      repo,
      manifest.records.map((row) => row.file),
    );
    for (const row of manifest.records) {
      const file = await this.relative(repo, row.file),
        target = path.join(repo, file);
      if (row.exists) {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.cp(path.join(folder, "files", file), target, {
          recursive: true,
          dereference: false,
        });
      } else await fs.rm(target, { recursive: true, force: true });
    }
    return `Recovered backup ${id}.\n${current}`;
  }

  async action(input, operation, args = {}) {
    const repo = await this.root(input),
      { common } = await this.metadata(repo);
    return this.queue(common, async () => {
      const calls = [],
        outputs = [];
      const run = async (command) => {
        calls.push(commandString(command));
        const result = await this.git(repo, command, { includeStderr: true });
        if (result.trim()) outputs.push(result.trim());
        return result;
      };
      const currentBranch = () =>
        this.optional(repo, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
      let before = "",
        backup = "",
        stash = "",
        journalMode = "",
        beforeBranch = "",
        beforeIndex = null,
        afterIndex = null,
        autoStash = null;
      const prepare = async (targets, replay = false) => {
        if (args.autoStash !== undefined && typeof args.autoStash !== "boolean")
          throw new Error("Autostash must be explicitly enabled or disabled.");
        const active = await this.operation(repo);
        if (active)
          throw new Error(
            `Finish or abort the ${active} operation before ${operation}.`,
          );
        for (const target of targets)
          await this.guardIgnoredReset(repo, target, operation, replay);
        if (args.autoStash !== true) return;
        const pending = await this.pendingAutoStash(repo);
        if (pending)
          throw new Error(
            `A previous autostash still needs restoration.\n${this.autoStashNotice(pending)}`,
          );
        const status = await this.git(repo, [
          "status",
          "--porcelain=v1",
          "-z",
          "--untracked-files=all",
        ]);
        if (!status) return;
        if (parseStatus(status).some((file) => file.conflict))
          throw new Error(
            "Resolve the index conflicts before using autostash.",
          );
        const originalHead = await this.resolve(repo, "HEAD");
        autoStash = {
          hash: "",
          ref: "",
          restored: false,
          conflict: false,
          operation,
          originalHead,
          originalBranch: (await currentBranch()).trim(),
          awaitingOperation: null,
        };
        const previous = (
          await this.optional(repo, ["rev-parse", "--verify", "refs/stash"])
        ).trim();
        try {
          await run([
            "stash",
            "push",
            "--include-untracked",
            "-m",
            `Branchline autostash ${operation} ${randomUUID()}`,
          ]);
        } finally {
          // Git may save the entry but fail to clean a path (for example a dirty
          // submodule). Make that saved data reachable before reporting failure.
          const saved = (
            await this.optional(repo, ["rev-parse", "--verify", "refs/stash"])
          ).trim();
          if (saved && saved !== previous) {
            autoStash.hash = saved;
            autoStash.ref = await this.backupRef(repo, saved);
            await this.writeAutoStash(repo, autoStash);
          }
        }
        if (
          !autoStash.hash ||
          (await this.git(repo, [
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
          ]))
        )
          throw new Error(
            "Autostash could not leave a clean worktree. Changes inside submodules or nested repositories must be saved separately; the operation was not started.",
          );
      };
      try {
        if (["commit", "reset"].includes(operation)) {
          before = (
            await this.optional(repo, ["rev-parse", "--verify", "HEAD"])
          ).trim();
          beforeBranch = (await currentBranch()).trim();
          backup = await this.backupRef(repo);
        }
        switch (operation) {
          case "stage":
          case "unstage":
          case "untrack": {
            const files = Array.isArray(args.files)
              ? await Promise.all(args.files.map((f) => this.relative(repo, f)))
              : [];
            if (operation === "stage")
              await run(["add", "-A", "--", ...(files.length ? files : ["."])]);
            else if (operation === "untrack") {
              if (!files.length)
                throw new Error("Select files to stop tracking.");
              await run(["rm", "--cached", "-r", "--", ...files]);
            } else if (
              (
                await this.optional(repo, ["rev-parse", "--verify", "HEAD"])
              ).trim()
            )
              await run([
                "restore",
                "--staged",
                "--",
                ...(files.length ? files : ["."]),
              ]);
            else
              await run([
                "rm",
                "--cached",
                "-r",
                "--ignore-unmatch",
                "--",
                ...(files.length ? files : ["."]),
              ]);
            break;
          }
          case "discard":
            outputs.push(await this.discard(repo, args.files));
            break;
          case "discard.restore":
            outputs.push(await this.restoreDiscard(repo, args.backup));
            break;
          case "ignore": {
            if (!Array.isArray(args.files) || !args.files.length)
              throw new Error("Select files to ignore.");
            const files = await Promise.all(
                args.files.map((f) => this.relative(repo, f)),
              ),
              ignore = await this.relative(repo, ".gitignore");
            const old = await fs
              .readFile(path.join(repo, ignore), "utf8")
              .catch((error) => {
                if (error.code === "ENOENT") return "";
                throw error;
              });
            const patterns = files
              .map(
                (f) =>
                  "/" + f.replace(/[\\*?[\]#!]/g, "\\$&").replace(/ /g, "\\ "),
              )
              .filter((f) => !old.split("\n").includes(f));
            await fs.writeFile(
              path.join(repo, ignore),
              old +
                (old && !old.endsWith("\n") ? "\n" : "") +
                patterns.join("\n") +
                (patterns.length ? "\n" : ""),
            );
            outputs.push(`Added ${patterns.length} rule(s) to .gitignore.`);
            break;
          }
          case "commit": {
            if (typeof args.message !== "string" || !args.message.trim())
              throw new Error("Enter a commit message.");
            const command = ["commit", "-m", args.message];
            if (args.description) command.push("-m", String(args.description));
            if (args.amend) command.push("--amend");
            if (args.sign) command.push("-S");
            await run(command);
            journalMode = "soft";
            break;
          }
          case "branch.create": {
            const name = await this.branchName(repo, args.name);
            const start = args.start
              ? [await this.resolve(repo, args.start)]
              : [];
            await run(
              args.checkout
                ? ["switch", "-c", name, ...start]
                : ["branch", name, ...start],
            );
            break;
          }
          case "branch.checkout": {
            value(args.name, "Branch or commit");
            const local = await this.optional(repo, [
              "show-ref",
              "--verify",
              `refs/heads/${args.name}`,
            ]);
            if (local) {
              await prepare([
                await this.resolve(repo, `refs/heads/${args.name}`),
              ]);
              await run(["switch", "--no-overwrite-ignore", args.name]);
            } else {
              const remote = (
                await this.git(repo, [
                  "for-each-ref",
                  "--format=%(refname:short)",
                  "refs/remotes",
                ])
              )
                .split("\n")
                .filter(Boolean);
              const hash = await this.resolve(repo, args.name);
              await prepare([hash]);
              if (remote.includes(args.name) && args.name !== "origin/HEAD")
                await run([
                  "switch",
                  "--no-overwrite-ignore",
                  "--track",
                  args.name,
                ]);
              else {
                backup = await this.backupRef(repo);
                await run([
                  "switch",
                  "--no-overwrite-ignore",
                  "--detach",
                  hash,
                ]);
              }
            }
            break;
          }
          case "commit.checkout": {
            if (
              typeof args.hash !== "string" ||
              !/^[a-f\d]{7,64}$/i.test(args.hash)
            )
              throw new Error(
                "Select a valid commit hash for detached checkout.",
              );
            const hash = await this.resolve(repo, args.hash);
            await prepare([hash]);
            backup = await this.backupRef(repo);
            await run(["switch", "--no-overwrite-ignore", "--detach", hash]);
            outputs.push(
              `Detached HEAD at ${hash}. Create a branch here before keeping new commits.`,
            );
            break;
          }
          case "branch.rename":
            await run([
              "branch",
              "-m",
              await this.branchName(repo, args.name),
              await this.branchName(repo, args.newName),
            ]);
            break;
          case "branch.delete": {
            const name = await this.branchName(repo, args.name);
            backup = await this.backupRef(repo, `refs/heads/${name}`);
            await run(["branch", args.force ? "-D" : "-d", name]);
            break;
          }
          case "merge": {
            const hash = await this.resolve(repo, args.ref);
            await prepare([hash]);
            backup = await this.backupRef(repo);
            await run([
              "merge",
              "--no-autostash",
              "--no-overwrite-ignore",
              "--no-edit",
              ...(args.squash ? ["--squash"] : []),
              hash,
            ]);
            break;
          }
          case "rebase": {
            const hash = await this.resolve(repo, args.ref);
            await prepare([hash], true);
            backup = await this.backupRef(repo);
            await run(["rebase", "--no-autostash", hash]);
            break;
          }
          case "interactive.rebase":
            await this.interactiveRebase(repo, args, calls, outputs);
            break;
          case "cherryPick":
            backup = await this.backupRef(repo);
            await run(["cherry-pick", await this.resolve(repo, args.hash)]);
            break;
          case "revert":
            backup = await this.backupRef(repo);
            await run([
              "revert",
              "--no-edit",
              await this.resolve(repo, args.hash),
            ]);
            break;
          case "reset": {
            if (!["soft", "mixed", "hard"].includes(args.mode))
              throw new Error("Select a reset mode: soft, mixed, or hard.");
            const hash = await this.resolve(repo, args.ref);
            if (args.mode === "hard") {
              await this.guardIgnoredReset(repo, hash);
              stash = await this.protectWorking(repo, "before hard reset");
            }
            if (args.mode === "mixed")
              beforeIndex = await this.captureIndex(repo);
            await run(["reset", `--${args.mode}`, hash]);
            if (args.mode === "mixed")
              afterIndex = await this.captureIndex(repo);
            journalMode = args.mode;
            break;
          }
          case "undo":
          case "redo": {
            const data = await this.journal(repo),
              source = data[operation],
              target = data[operation === "undo" ? "redo" : "undo"],
              entry = source.at(-1);
            if (!entry)
              throw new Error(`No local action available to ${operation}.`);
            const head = (
                await this.git(repo, ["rev-parse", "--verify", "HEAD"])
              ).trim(),
              expected = operation === "undo" ? entry.after : entry.before;
            if (
              head !== expected ||
              (await currentBranch()).trim() !== entry.branch
            )
              throw new Error(
                "The repository HEAD changed after this action or a different branch is checked out. Use the reflog to recover safely.",
              );
            if (!entry.before)
              throw new Error(
                "Undo of the initial commit is not supported. Use a new branch or revert.",
              );
            await this.backupRef(repo);
            if (entry.mode === "hard") {
              await this.guardIgnoredReset(
                repo,
                operation === "undo" ? entry.before : entry.after,
              );
              const protection = await this.protectWorking(
                repo,
                `before ${operation}`,
              );
              if (protection)
                outputs.push(`Current work preserved in stash ${protection}.`);
            }
            if (entry.mode === "mixed") {
              const protection = await this.captureIndex(repo);
              if (protection.ref)
                outputs.push(
                  `Current index preserved in recovery ref ${protection.ref}.`,
                );
            }
            await run([
              "reset",
              `--${entry.mode}`,
              operation === "undo" ? entry.before : entry.after,
            ]);
            if (entry.mode === "mixed")
              await this.restoreIndex(
                repo,
                operation === "undo" ? entry.beforeIndex : entry.afterIndex,
              );
            if (operation === "undo" && entry.stash) {
              await run(["stash", "apply", "--index", entry.stash]);
              outputs.push(
                "Pre-reset changes restored; the recovery stash remains available.",
              );
            }
            source.pop();
            target.push(entry);
            await this.writeJournal(repo, data);
            break;
          }
          case "fetch": {
            const remote = args.remote
              ? [value(args.remote, "Remote name")]
              : ["--all"];
            await run(["fetch", ...(args.prune ? ["--prune"] : []), ...remote]);
            break;
          }
          case "pull": {
            const remote = args.remote
              ? [value(args.remote, "Remote name")]
              : [];
            const active = await this.operation(repo);
            if (active)
              throw new Error(
                `Finish or abort the ${active} operation before pulling.`,
              );
            const branch = (await currentBranch()).trim();
            const tracking =
              branch &&
              (
                await this.optional(repo, [
                  "config",
                  "--get-all",
                  `branch.${branch}.merge`,
                ])
              ).trim();
            if (!tracking)
              throw new Error(
                "Pull requires an upstream branch. Set the branch upstream before pulling.",
              );
            const upstream = (
              await this.optional(repo, [
                "rev-parse",
                "--abbrev-ref",
                "--symbolic-full-name",
                "@{upstream}",
              ])
            ).trim();
            const forkPoint =
              args.rebase && upstream
                ? (
                    await this.optional(repo, [
                      "merge-base",
                      "--fork-point",
                      upstream,
                      "HEAD",
                    ])
                  ).trim()
                : "";
            // Fetch first and integrate exactly the fetched OID: this permits
            // ignored-path checks without a second network fetch or stale target.
            await run(["fetch", ...remote]);
            const { gitdir } = await this.metadata(repo);
            const fetched = await fs.readFile(
              path.join(gitdir, "FETCH_HEAD"),
              "utf8",
            );
            const targets = [
              ...new Set(
                fetched
                  .split("\n")
                  .map((line) => line.split("\t"))
                  .filter(
                    (row) => row[1] === "" && /^[a-f\d]{40,64}$/.test(row[0]),
                  )
                  .map((row) => row[0]),
              ),
            ];
            if (!targets.length)
              throw new Error(
                "The fetch did not select an upstream branch to integrate. Check the branch tracking configuration and selected remote.",
              );
            if (args.rebase && targets.length !== 1)
              throw new Error(
                "Rebase pull requires exactly one upstream branch.",
              );
            const ff = (
              await this.optional(repo, ["config", "--get", "pull.ff"])
            ).trim();
            if (ff === "only") {
              for (const hash of targets) {
                try {
                  await this.git(repo, [
                    "merge-base",
                    "--is-ancestor",
                    "HEAD",
                    hash,
                  ]);
                } catch {
                  throw new Error(
                    "Pull is configured for fast-forward only, but local and remote history have diverged.",
                  );
                }
              }
            }
            await prepare(targets, !!args.rebase);
            backup = await this.backupRef(repo);
            if (args.rebase)
              await run([
                "rebase",
                "--no-autostash",
                ...(forkPoint ? ["--onto", targets[0], forkPoint] : targets),
              ]);
            else
              await run([
                "merge",
                "--no-autostash",
                "--no-overwrite-ignore",
                "--no-edit",
                ...(ff === "only"
                  ? ["--ff-only"]
                  : ff === "false"
                    ? ["--no-ff"]
                    : ["--ff"]),
                ...targets,
              ]);
            break;
          }
          case "push":
            await run([
              "push",
              ...(args.force ? ["--force-with-lease"] : []),
              ...(args.setUpstream ? ["--set-upstream"] : []),
              ...(args.remote ? [value(args.remote, "Remote name")] : []),
              ...(args.branch
                ? [await this.branchName(repo, args.branch)]
                : []),
            ]);
            break;
          case "stash.create":
            await run([
              "stash",
              "push",
              ...(args.includeUntracked ? ["--include-untracked"] : []),
              ...(args.message ? ["-m", String(args.message)] : []),
            ]);
            break;
          case "stash.apply":
          case "stash.pop":
          case "stash.drop": {
            const ref = value(args.ref, "Stash reference");
            if (operation !== "stash.apply" && !/^stash@\{\d+\}$/.test(ref))
              throw new Error("Select a stash from the stash list.");
            const hash = await this.resolve(repo, ref);
            const pending = await this.pendingAutoStash(repo);
            if (pending?.hash === hash && operation !== "stash.drop") {
              if (await this.operation(repo))
                throw new Error(
                  "Finish or abort the Git operation before restoring the pending autostash.",
                );
              autoStash = pending;
            }
            if (operation === "stash.apply" && !/^stash@\{\d+\}$/.test(ref)) {
              const parents = (
                await this.git(repo, ["rev-list", "--parents", "-n", "1", hash])
              )
                .trim()
                .split(" ");
              if (parents.length < 3)
                throw new Error("Select a saved stash commit or recovery ref.");
            }
            if (operation !== "stash.apply")
              backup = await this.backupRef(repo, ref);
            await run([
              "stash",
              operation.split(".")[1],
              ...(args.index && operation !== "stash.drop" ? ["--index"] : []),
              operation === "stash.apply" ? hash : ref,
            ]);
            if (pending?.hash === hash) {
              if (operation === "stash.drop") {
                await this.writeAutoStash(repo, null);
                outputs.push(
                  `The pending autostash entry was removed explicitly. Its contents remain recoverable with git stash apply --index ${pending.ref}.`,
                );
              } else {
                autoStash.restored = true;
                autoStash.conflict = false;
                await this.writeAutoStash(repo, null);
                outputs.push(
                  `Pending autostash restored manually; recovery ref remains ${pending.ref}.`,
                );
              }
            }
            break;
          }
          case "tag.create":
            await run([
              "tag",
              ...(args.message ? ["-a", "-m", String(args.message)] : []),
              await this.refName(repo, args.name),
              ...(args.ref ? [await this.resolve(repo, args.ref)] : []),
            ]);
            break;
          case "tag.delete": {
            const name = await this.refName(repo, args.name);
            backup = await this.backupRef(repo, `refs/tags/${name}`);
            await run(["tag", "-d", name]);
            break;
          }
          case "remote.add":
            await run([
              "remote",
              "add",
              value(args.name, "Remote name"),
              safeURL(args.url),
            ]);
            break;
          case "remote.remove":
            await run(["remote", "remove", value(args.name, "Remote name")]);
            break;
          case "remote.setUrl":
            await run([
              "remote",
              "set-url",
              value(args.name, "Remote name"),
              safeURL(args.url),
            ]);
            break;
          case "worktree.add": {
            value(args.destination, "Worktree destination");
            const destination = path.resolve(args.destination);
            if (inside(repo, destination))
              throw new Error(
                "Place a linked worktree outside the current repository.",
              );
            const command = ["worktree", "add"];
            if (args.newBranch)
              command.push("-b", await this.branchName(repo, args.newBranch));
            command.push(destination);
            if (args.branch) {
              value(args.branch, "Branch");
              command.push(args.branch);
            }
            await run(command);
            break;
          }
          case "worktree.remove":
          case "worktree.lock":
          case "worktree.unlock": {
            value(args.destination, "Worktree destination");
            const destination = await fs.realpath(
              path.resolve(args.destination),
            );
            const trees = parseWorktrees(
              await this.git(repo, ["worktree", "list", "--porcelain", "-z"]),
            );
            if (
              !trees.some((t) => t.path === destination) ||
              destination === repo
            )
              throw new Error(
                "Select a linked worktree belonging to this repository.",
              );
            await run(["worktree", operation.split(".")[1], destination]);
            break;
          }
          case "operation.continue":
          case "operation.abort": {
            if (
              !["merge", "rebase", "cherry-pick", "revert"].includes(args.kind)
            )
              throw new Error("Invalid operation.");
            if ((await this.operation(repo)) !== args.kind)
              throw new Error(`No ${args.kind} operation is in progress.`);
            // GIT_EDITOR prevents an editor prompt in the desktop process.
            const { gitdir } = await this.metadata(repo),
              statePath = path.join(
                gitdir,
                "branchline",
                "rebase",
                "current.json",
              );
            const state =
              args.kind === "rebase"
                ? await fs
                    .readFile(statePath, "utf8")
                    .then(JSON.parse, () => null)
                : null;
            const command = [
              args.kind,
              operation.endsWith("continue") ? "--continue" : "--abort",
            ];
            calls.push(commandString(command));
            const result = await this.git(repo, command, {
              includeStderr: true,
              env: {
                ...process.env,
                GIT_EDITOR: state ? `${state.editor} message` : "true",
                GIT_SEQUENCE_EDITOR: "true",
                GIT_TERMINAL_PROMPT: "0",
                GIT_PAGER: "cat",
                LC_ALL: "C",
              },
            });
            if (result.trim()) outputs.push(result.trim());
            if (state && !(await this.operation(repo))) {
              await fs.rm(state.directory, { recursive: true, force: true });
              await fs.rm(statePath, { force: true });
            }
            const pending = await this.pendingAutoStash(repo);
            if (
              pending?.awaitingOperation === args.kind &&
              !(await this.operation(repo))
            ) {
              autoStash = pending;
              await this.restoreAutoStash(repo, autoStash, run, outputs);
            }
            break;
          }
          case "conflict.resolve": {
            const file = await this.relative(repo, args.file),
              status = parseStatus(
                await this.git(repo, [
                  "status",
                  "--porcelain=v1",
                  "-z",
                  "--",
                  file,
                ]),
              );
            if (!status.some((s) => s.conflict))
              throw new Error("This file has no unresolved conflict.");
            if (args.remove === true) {
              await run(["rm", "-f", "--", file]);
              break;
            }
            if (typeof args.content === "string")
              await fs.writeFile(path.join(repo, file), args.content);
            else {
              if (!["ours", "theirs"].includes(args.strategy))
                throw new Error(
                  "Select ours, theirs, or supply resolved content.",
                );
              const stages = await this.git(repo, [
                "ls-files",
                "--stage",
                "-z",
                "--",
                file,
              ]);
              const selectedStage = args.strategy === "ours" ? "2" : "3";
              if (
                !stages
                  .split("\0")
                  .some(
                    (entry) =>
                      /^\d+ [a-f0-9]+ (\d)\t/.exec(entry)?.[1] ===
                      selectedStage,
                  )
              ) {
                await run(["rm", "-f", "--", file]);
                break;
              }
              await run(["checkout", `--${args.strategy}`, "--", file]);
            }
            await run(["add", "--", file]);
            break;
          }
          case "hunk.stage":
          case "hunk.unstage":
          case "patch.apply": {
            await this.validatePatch(repo, args.patch);
            const command = ["apply", "--whitespace=nowarn"];
            if (operation.startsWith("hunk.")) command.push("--cached");
            else if (args.staged) command.push("--index");
            if (operation === "hunk.unstage") command.push("--reverse");
            const check = [...command, "--check", "-"];
            await this.gitInput(repo, check, args.patch);
            command.push("-");
            calls.push(commandString(command));
            outputs.push(await this.gitInput(repo, command, args.patch));
            break;
          }
          case "patch.export":
            outputs.push(await this.diff(repo, args));
            break;
          case "identity":
            if (
              typeof args.name !== "string" ||
              !args.name.trim() ||
              typeof args.email !== "string" ||
              !args.email.trim() ||
              /[\r\n\0]/.test(args.name + args.email)
            )
              throw new Error("Enter a valid name and email.");
            await run(["config", "--local", "user.name", args.name]);
            await run(["config", "--local", "user.email", args.email]);
            break;
          case "gitflow.init": {
            const main = await this.branchName(repo, args.main),
              develop = await this.branchName(repo, args.develop);
            if (main === develop)
              throw new Error("Main and develop branches must be different.");
            for (const branch of [main, develop])
              if (
                !(
                  await this.optional(repo, [
                    "show-ref",
                    "--verify",
                    `refs/heads/${branch}`,
                  ])
                ).trim()
              )
                await run(["branch", branch, "HEAD"]);
            await run(["config", "--local", "gitflow.branch.master", main]);
            await run(["config", "--local", "gitflow.branch.develop", develop]);
            outputs.push("Git Flow initialized.");
            break;
          }
          case "gitflow.start":
          case "gitflow.finish": {
            if (!["feature", "release", "hotfix"].includes(args.kind))
              throw new Error("Select a Git Flow kind.");
            const main = (
                await this.optional(repo, [
                  "config",
                  "--local",
                  "--get",
                  "gitflow.branch.master",
                ])
              ).trim(),
              develop = (
                await this.optional(repo, [
                  "config",
                  "--local",
                  "--get",
                  "gitflow.branch.develop",
                ])
              ).trim();
            if (!main || !develop)
              throw new Error("Initialize Git Flow first.");
            const name = await this.branchName(
              repo,
              `${args.kind}/${value(args.name, "Git Flow name")}`,
            );
            if (operation.endsWith("start"))
              await run([
                "switch",
                "-c",
                name,
                args.kind === "hotfix" ? main : develop,
              ]);
            else {
              if ((await this.git(repo, ["status", "--porcelain=v1"])).trim())
                throw new Error(
                  "Commit or stash current changes before finishing Git Flow.",
                );
              const source = await this.resolve(repo, `refs/heads/${name}`);
              backup = await this.backupRef(repo, source);
              const targets =
                args.kind === "feature" ? [develop] : [main, develop];
              for (const target of targets) {
                await this.backupRef(repo, `refs/heads/${target}`);
                await run(["switch", target]);
                await run(["merge", "--no-ff", "--no-edit", source]);
                if (target === main)
                  await run([
                    "tag",
                    "-a",
                    await this.refName(repo, args.name),
                    "-m",
                    `${args.kind} ${args.name}`,
                  ]);
              }
              await run(["branch", "-d", name]);
            }
            break;
          }
          case "submodule.add":
            await run([
              "submodule",
              "add",
              safeURL(args.url),
              await this.relative(repo, args.destination),
            ]);
            break;
          case "submodule.update":
            await run(["submodule", "update", "--init", "--recursive"]);
            break;
          case "lfs.status":
            await run(["lfs", "status"]);
            break;
          case "lfs.track": {
            const file = await this.relative(repo, args.file);
            await run(["lfs", "track", "--", file]);
            break;
          }
          default:
            throw new Error(`Unsupported Git action: ${operation}`);
        }
        if (
          autoStash?.hash &&
          [
            "branch.checkout",
            "commit.checkout",
            "merge",
            "rebase",
            "pull",
          ].includes(operation)
        )
          await this.restoreAutoStash(repo, autoStash, run, outputs);
        if (journalMode) {
          const after = (
            await this.git(repo, ["rev-parse", "--verify", "HEAD"])
          ).trim();
          if (before !== after || journalMode === "mixed" || stash) {
            const data = await this.journal(repo);
            data.undo.push({
              operation,
              before,
              after,
              branch: beforeBranch,
              mode: journalMode,
              backup,
              stash,
              beforeIndex,
              afterIndex,
            });
            data.undo = data.undo.slice(-100);
            data.redo = [];
            await this.writeJournal(repo, data);
          }
        }
        if (backup) outputs.push(`Recovery ref: ${backup}`);
        if (stash)
          outputs.push(`Working changes preserved in recovery stash: ${stash}`);
        const result = {
          output: outputs.filter(Boolean).join("\n") || "Done.",
          command: calls.join(" ; ") || operation,
          ...(autoStash?.hash ? { autoStash } : {}),
        };
        this.emit(repo, operation, result.command, true, result.output);
        return result;
      } catch (error) {
        if (autoStash?.hash && !autoStash.restored) {
          autoStash.awaitingOperation = await this.operation(repo);
          if (operation === "stash.apply" || operation === "stash.pop")
            autoStash.conflict = true;
          await this.writeAutoStash(repo, autoStash).catch(() => {});
        }
        const suffix = [
          backup ? `Recovery ref: ${backup}` : "",
          stash ? `Working changes preserved in recovery stash: ${stash}` : "",
          autoStash?.hash ? this.autoStashNotice(autoStash) : "",
          !args.autoStash &&
          [
            "branch.checkout",
            "commit.checkout",
            "merge",
            "rebase",
            "pull",
          ].includes(operation) &&
          /local changes|untracked working tree|unstaged changes|uncommitted changes/i.test(
            error.message,
          )
            ? "Retry with Autostash enabled to preserve staged, unstaged and untracked changes before this operation."
            : "",
        ]
          .filter(Boolean)
          .join("\n");
        if (suffix) error.message += `\n${suffix}`;
        this.emit(
          repo,
          operation,
          calls.join(" ; ") || operation,
          false,
          error.message,
        );
        throw error;
      }
    });
  }
  emit(repo, operation, command, success, output) {
    if (this.onActivity) {
      try {
        this.onActivity({
          id: randomUUID(),
          time: new Date().toISOString(),
          repo,
          operation,
          command: cleanLog(command),
          success,
          output: cleanLog(output).slice(0, 100000),
        });
      } catch {}
    }
  }
  async clone(url, destination) {
    safeURL(url);
    value(destination, "Clone destination");
    const target = path.resolve(destination);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await this.queue(target, async () => {
      try {
        const output = await this.git(null, ["clone", "--", url, target], {
          timeout: 600000,
          includeStderr: true,
        });
        this.emit(
          target,
          "clone",
          commandString(["clone", url, target]),
          true,
          output,
        );
      } catch (error) {
        this.emit(
          target,
          "clone",
          commandString(["clone", url, target]),
          false,
          error.message,
        );
        throw error;
      }
    });
    return this.snapshot(target);
  }
  async init(input) {
    value(input, "Repository directory");
    const repo = path.resolve(input);
    await fs.mkdir(repo, { recursive: true });
    const canonical = await fs.realpath(repo);
    await this.queue(canonical, async () => {
      const output = await this.git(null, [
        "init",
        "--initial-branch=main",
        "--",
        canonical,
      ]);
      this.emit(
        canonical,
        "init",
        commandString(["init", canonical]),
        true,
        output,
      );
    });
    return this.snapshot(canonical);
  }
}

module.exports = { GitService };
