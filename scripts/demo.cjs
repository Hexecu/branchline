const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const DEMO_ID = "branchline-orbit-demo-v1";

/** Create an entirely owned Git playground. Existing demos retain all user edits. */
async function createDemo(baseDir) {
  if (typeof baseDir !== "string" || !baseDir.trim())
    throw new Error("Serve una directory per la demo.");
  const root = path.resolve(baseDir);
  const repoPath = path.join(root, "orbit-workspace");
  const remotePath = path.join(root, "orbit-origin.git");
  const worktreePath = path.join(root, "orbit-offline");
  const markerPath = path.join(repoPath, ".git", "branchline-demo.json");
  const hasMarker = (file) => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")).id === DEMO_ID;
    } catch {
      return false;
    }
  };

  if (fs.existsSync(repoPath)) {
    if (!hasMarker(markerPath))
      throw new Error(
        `La directory ${repoPath} esiste già e non appartiene alla demo.`,
      );
    return repoPath;
  }
  if (fs.existsSync(worktreePath))
    throw new Error(
      `La directory ${worktreePath} esiste già: la demo non la modifica.`,
    );
  const remoteMarker = path.join(remotePath, "branchline-demo.json");
  if (fs.existsSync(remotePath) && !hasMarker(remoteMarker)) {
    throw new Error(
      `Il repository ${remotePath} esiste già e non appartiene alla demo.`,
    );
  }

  fs.mkdirSync(root, { recursive: true });
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
  };
  const git = (args, cwd = repoPath, extraEnv = {}) =>
    execFileSync("git", args, {
      cwd,
      env: { ...env, ...extraEnv },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const write = (file, content) => {
    const target = path.join(repoPath, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
  };
  const append = (file, content) =>
    fs.appendFileSync(path.join(repoPath, file), content, "utf8");
  const authors = [
    ["Sofia Rossi", "sofia@example.invalid"],
    ["Marco Bianchi", "marco@example.invalid"],
    ["Alex Chen", "alex@example.invalid"],
  ];
  let clock = new Date();
  clock.setUTCHours(9, 0, 0, 0);
  clock = clock.getTime() - 5 * 24 * 60 * 60 * 1000;
  let commitNumber = 0;
  const commit = (message, author = 0, args = []) => {
    git(["add", "--all"]);
    const date = new Date(
      clock + commitNumber++ * 3 * 60 * 60 * 1000,
    ).toISOString();
    return git(["commit", "-m", message, ...args], repoPath, {
      GIT_AUTHOR_NAME: authors[author][0],
      GIT_AUTHOR_EMAIL: authors[author][1],
      GIT_COMMITTER_NAME: authors[author][0],
      GIT_COMMITTER_EMAIL: authors[author][1],
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    });
  };
  const merge = (branch, message, author) => {
    const date = new Date(
      clock + commitNumber++ * 3 * 60 * 60 * 1000,
    ).toISOString();
    git(["merge", "--no-ff", branch, "-m", message], repoPath, {
      GIT_AUTHOR_NAME: authors[author][0],
      GIT_AUTHOR_EMAIL: authors[author][1],
      GIT_COMMITTER_NAME: authors[author][0],
      GIT_COMMITTER_EMAIL: authors[author][1],
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    });
    git(["branch", "-d", branch]);
  };
  let createdRemote = false;
  let createdRepo = false;
  let createdWorktree = false;

  try {
    fs.mkdirSync(repoPath);
    createdRepo = true;
    git(["init", "-b", "main"]);
    git(["config", "user.name", authors[0][0]]);
    git(["config", "user.email", authors[0][1]]);
    git(["config", "commit.gpgsign", "false"]);
    git(["config", "tag.gpgsign", "false"]);
    git(["config", "core.autocrlf", "false"]);
    git([
      "config",
      "core.hooksPath",
      path.join(repoPath, ".git", "empty-hooks"),
    ]);
    fs.mkdirSync(path.join(repoPath, ".git", "empty-hooks"));

    write(".gitignore", "node_modules/\n.DS_Store\n.env\ncoverage/\n");
    write(
      "package.json",
      JSON.stringify(
        {
          name: "orbit-workspace",
          version: "0.7.0",
          private: true,
          type: "module",
          description: "An intentionally small, local team planning app",
          scripts: { start: "node server.mjs" },
        },
        null,
        2,
      ) + "\n",
    );
    write(
      "index.html",
      `<!doctype html>
<html lang="it"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Orbit — Team workspace</title><link rel="stylesheet" href="/src/styles.css"></head>
<body><div id="app"></div><script type="module" src="/src/main.js"></script></body></html>
`,
    );
    write(
      "server.mjs",
      `import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve('.');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(root, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
    if (!file.startsWith(root + sep)) { res.writeHead(403); return res.end('Forbidden'); }
    const content = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
    res.end(content);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(4178, '127.0.0.1', () => console.log('Orbit: http://127.0.0.1:4178'));
`,
    );
    write(
      "src/main.js",
      `document.querySelector('#app').innerHTML = '<main><h1>Orbit</h1><p>Il tuo prossimo passo, a fuoco.</p></main>';
`,
    );
    write(
      "src/styles.css",
      ":root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; background: #11151d; color: #ecf2fa; }\nbody { margin: 0; }\nmain { max-width: 1080px; margin: 80px auto; padding: 24px; }\n",
    );
    commit("chore: create the Orbit workspace", 0);

    write(
      "src/store.js",
      `export const tasks = [
  { id: 'ORB-101', title: 'Ship the workspace dashboard', status: 'In progress', owner: 'Sofia', priority: 'High' },
  { id: 'ORB-102', title: 'Make search feel instant', status: 'In review', owner: 'Marco', priority: 'Medium' },
  { id: 'ORB-103', title: 'Document our keyboard shortcuts', status: 'Planned', owner: 'Alex', priority: 'Low' },
  { id: 'ORB-104', title: 'Keep drafts available offline', status: 'In progress', owner: 'Sofia', priority: 'High' },
];
export const team = ['Sofia', 'Marco', 'Alex'];
`,
    );
    commit("feat: add shared task and team models", 1);

    append(
      "src/styles.css",
      `.shell { display: grid; grid-template-columns: 210px 1fr; gap: 42px; }
aside { border-right: 1px solid #283142; padding-right: 28px; }
.logo { color: #7ce2c5; letter-spacing: -1px; font-size: 28px; }
.nav { display: grid; gap: 12px; margin-top: 40px; color: #95a1b7; }
.nav strong { color: #edf3fa; }
.eyebrow { color: #94a0b6; font-size: 12px; letter-spacing: 2px; text-transform: uppercase; }
h1 { font-size: 40px; letter-spacing: -1.5px; margin: 16px 0; }
.subtitle { color: #a1adc0; }
`,
    );
    commit("style: introduce the midnight and mint design system", 2);

    write(
      "src/main.js",
      `import { tasks, team } from './store.js';
const escape = (text) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
document.querySelector('#app').innerHTML = \
  '<main class="shell"><aside><strong class="logo">◉ orbit</strong><nav class="nav"><strong>Overview</strong><span>My work</span><span>Projects</span><span>Activity</span></nav></aside>' +
  '<section><div class="eyebrow">TEAM WORKSPACE / PRODUCT</div><h1>A little focus. A lot of progress.</h1>' +
  '<p class="subtitle">' + team.length + ' teammates · ' + tasks.length + ' priorities · one clear direction</p>' +
  '<div class="task-list">' + tasks.map(task => '<article class="task"><span class="task-id">' + task.id + '</span><h3>' + escape(task.title) + '</h3><div><span class="status">' + task.status + '</span><span class="owner">' + task.owner + '</span></div></article>').join('') + '</div></section></main>';
`,
    );
    append(
      "src/styles.css",
      `.task-list { display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px; margin-top: 36px; }
.task { border: 1px solid #2b3547; border-radius: 14px; background: #1b2230; padding: 24px; }
.task-id { color: #8795af; font-family: monospace; font-size: 12px; }
.task h3 { font-size: 18px; font-weight: 500; min-height: 42px; }
.task > div { display: flex; align-items: center; justify-content: space-between; }
.status { color: #7ce2c5; border: 1px solid #37574f; border-radius: 6px; padding: 5px 9px; font-size: 12px; }
.owner { color: #aebbd0; font-size: 13px; }
`,
    );
    commit("feat: render a focused overview with task cards", 0);

    write(
      "src/settings.js",
      `const defaults = { theme: 'midnight', language: 'it', compact: false };
export function getSettings() {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem('orbit.settings') || '{}') }; }
  catch { return { ...defaults }; }
}
export function saveSettings(settings) { localStorage.setItem('orbit.settings', JSON.stringify(settings)); }
`,
    );
    commit("feat: persist workspace display preferences", 1);
    git(["tag", "-a", "v0.7.0", "-m", "Orbit foundation"]);

    git(["switch", "-c", "feature/insights"]);
    write(
      "src/insights.js",
      `export function completionRate(tasks) {
  if (!tasks.length) return 0;
  return Math.round(tasks.filter(task => task.status === 'Done').length / tasks.length * 100);
}
export function byOwner(tasks) {
  return tasks.reduce((groups, task) => ({ ...groups, [task.owner]: (groups[task.owner] || 0) + 1 }), {});
}
`,
    );
    commit("feat: calculate team progress and ownership insights", 2);
    write(
      "data/milestones.json",
      JSON.stringify(
        [
          { name: "Workspace foundations", date: "2026-09-18", progress: 100 },
          { name: "Search and navigation", date: "2026-10-02", progress: 64 },
          { name: "Offline workspace", date: "2026-10-09", progress: 28 },
        ],
        null,
        2,
      ) + "\n",
    );
    commit("feat: add a milestone timeline for the product team", 0);
    append(
      "src/styles.css",
      ".metric { padding: 20px; border-radius: 12px; border: 1px solid #2b3547; }\n.metric strong { display: block; font-size: 32px; color: #7ce2c5; }\n",
    );
    commit("style: add lightweight progress metric cards", 2);

    git(["switch", "main"]);
    write(
      "src/activity.js",
      `export const activity = [
  { author: 'Sofia', action: 'created the workspace', time: '2026-09-18T09:00:00Z' },
  { author: 'Marco', action: 'started instant search', time: '2026-09-19T11:30:00Z' },
];
export function formatActivity(event) { return event.author + ' ' + event.action; }
`,
    );
    commit("feat: introduce a readable team activity feed", 1);
    write(
      "docs/CONTRIBUTING.md",
      "# Contributing to Orbit\n\nKeep changes focused. Test the affected workflow, explain the intent, and include a screenshot for visual changes.\n\nCommit format: `type: short summary`.\n",
    );
    commit("docs: describe small changes and meaningful commits", 0);
    merge(
      "feature/insights",
      "Merge feature/insights — put team progress in context",
      0,
    );
    write(
      "README.md",
      "# Orbit\n\nA small team workspace with a local development server, useful tasks and calm visual design.\n\nRun `npm start` and open http://127.0.0.1:4178. No install or account is needed.\n\nThis is sample data for Branchline. The remote is another local repository; no network request is made.\n",
    );
    commit("docs: add a zero-dependency local quick start", 2);

    git(["switch", "-c", "fix/activity-timezones"]);
    append(
      "src/activity.js",
      `export function formatTime(iso, locale = 'it-IT') {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' }).format(new Date(iso));
}
`,
    );
    commit("fix: show activity timestamps in the workspace timezone", 1);
    write(
      "docs/ACCESSIBILITY.md",
      "# Accessibility\n\nEvery action needs a visible label, keyboard focus and sufficient contrast. Dates are formatted consistently for the workspace timezone.\n",
    );
    commit("docs: capture keyboard and date formatting requirements", 1);
    git(["switch", "main"]);
    write(
      "src/commands.js",
      `export const commands = [
  { id: 'overview', title: 'Go to overview', shortcut: 'G O' },
  { id: 'my-work', title: 'Open my work', shortcut: 'G M' },
  { id: 'new-task', title: 'Create a task', shortcut: 'C' },
];
`,
    );
    commit("feat: define navigation commands and shortcuts", 2);
    merge(
      "fix/activity-timezones",
      "Merge fix/activity-timezones — consistent activity dates",
      0,
    );
    git(["tag", "-a", "v0.8.0", "-m", "Team insights and accessible activity"]);

    git(["switch", "-c", "feature/smart-search"]);
    write(
      "src/search.js",
      `export function searchTasks(tasks, query) {
  const words = query.trim().toLocaleLowerCase().split(/\\s+/).filter(Boolean);
  return tasks.filter(task => words.every(word => (task.id + ' ' + task.title + ' ' + task.owner).toLocaleLowerCase().includes(word)));
}
`,
    );
    commit("feat: search task titles, identifiers and owners", 1);
    write(
      "src/filters.js",
      `export const quickFilters = [
  { label: 'My priorities', test: task => task.owner === 'Sofia' && task.priority === 'High' },
  { label: 'Ready to review', test: task => task.status === 'In review' },
  { label: 'Coming up', test: task => task.status === 'Planned' },
];
`,
    );
    commit("feat: add quick filters for the next useful task", 1);

    git(["switch", "main"]);
    git(["switch", "-c", "feature/command-palette"]);
    write(
      "src/palette.js",
      `import { commands } from './commands.js';
export function findCommands(query) {
  return commands.filter(command => command.title.toLowerCase().includes(query.toLowerCase()));
}
export function openPalette() { window.dispatchEvent(new CustomEvent('orbit:palette')); }
`,
    );
    commit("feat: add a searchable command palette model", 2);
    append(
      "src/palette.js",
      `document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    openPalette();
  }
});
`,
    );
    commit("feat: open the command palette with a familiar shortcut", 2);
    append(
      "src/styles.css",
      ".palette { width: min(560px, 90vw); margin: 15vh auto; background: #1b2230; border: 1px solid #3b4b66; border-radius: 16px; padding: 18px; box-shadow: 0 28px 100px #0009; }\n",
    );
    commit("style: make the command palette feel calm and immediate", 0);

    git(["switch", "main"]);
    append(
      "src/styles.css",
      `@media (max-width: 760px) {
  main { margin: 24px auto; }
  .shell { grid-template-columns: 1fr; gap: 24px; }
  aside { border-right: 0; border-bottom: 1px solid #283142; padding-bottom: 20px; }
  .nav { display: flex; margin-top: 20px; }
  .task-list { grid-template-columns: 1fr; }
  h1 { font-size: 32px; }
}
`,
    );
    const metadata = JSON.parse(
      fs.readFileSync(path.join(repoPath, "package.json"), "utf8"),
    );
    metadata.version = "0.9.0";
    write("package.json", JSON.stringify(metadata, null, 2) + "\n");
    commit("feat: polish the responsive workspace for the 0.9 release", 0);
    git(["tag", "-a", "v0.9.0", "-m", "A focused workspace, on every screen"]);

    if (!fs.existsSync(remotePath)) {
      fs.mkdirSync(remotePath);
      createdRemote = true;
      git(["init", "--bare", "-b", "main"], remotePath);
      fs.writeFileSync(remoteMarker, JSON.stringify({ id: DEMO_ID }) + "\n");
    }
    git(["remote", "add", "origin", remotePath]);
    git(["push", "-u", "origin", "main"]);
    git(["push", "origin", "--tags"]);
    git([
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/main",
    ]);

    git(["switch", "-c", "feature/offline-drafts"]);
    write(
      "src/offline.js",
      `const key = 'orbit.drafts';
export function getDrafts() { return JSON.parse(localStorage.getItem(key) || '[]'); }
export function saveDraft(draft) {
  const drafts = getDrafts().filter(item => item.id !== draft.id);
  localStorage.setItem(key, JSON.stringify([...drafts, { ...draft, updatedAt: Date.now() }]));
}
`,
    );
    commit("feat: keep task drafts available without a connection", 0);
    append(
      "src/offline.js",
      `export function removeDraft(id) {
  localStorage.setItem(key, JSON.stringify(getDrafts().filter(draft => draft.id !== id)));
}
`,
    );
    commit("feat: clear offline drafts after publishing", 1);

    git(["switch", "main"]);
    write(
      "docs/RELEASE-NOTES.md",
      "# Release 0.9\n\n- Responsive task overview.\n- Team progress and milestone data.\n- Consistent activity timestamps.\n\nIn progress: smart search, command palette and offline drafts.\n",
    );
    commit("docs: capture release highlights and what comes next", 2);
    git([
      "push",
      "origin",
      "feature/smart-search",
      "feature/command-palette",
      "feature/offline-drafts",
    ]);

    write(
      "src/notifications.js",
      `export function notify(message) {
  window.dispatchEvent(new CustomEvent('orbit:notification', { detail: message }));
}
`,
    );
    git(["add", "src/notifications.js"]);
    git([
      "stash",
      "push",
      "-m",
      "WIP: gentle notifications for completed tasks",
    ]);

    append(
      "src/styles.css",
      "\n/* Better focus rings for keyboard navigation. */\n:focus-visible { outline: 2px solid #7ce2c5; outline-offset: 4px; }\n",
    );
    git(["add", "src/styles.css"]);
    append(
      "src/main.js",
      "\n// Next: connect quick filters to the overview toolbar.\n",
    );
    append(
      "src/styles.css",
      ".task:hover { border-color: #476b64; transform: translateY(-1px); transition: 120ms ease; }\n",
    );
    write(
      "docs/SPRINT-NOTES.md",
      "# Sprint notes\n\n- Finish command palette focus management.\n- Review instant search keyboard navigation.\n- Measure the offline draft experience.\n",
    );

    createdWorktree = true;
    git(["worktree", "add", worktreePath, "feature/offline-drafts"]);
    fs.appendFileSync(
      path.join(worktreePath, "src/offline.js"),
      "\n// Follow-up: report quota errors before saving a draft.\n",
    );
    fs.writeFileSync(
      markerPath,
      JSON.stringify(
        {
          id: DEMO_ID,
          createdAt: new Date().toISOString(),
          commits: commitNumber,
        },
        null,
        2,
      ) + "\n",
    );
    return repoPath;
  } catch (error) {
    // These paths were created by this call and cannot contain pre-existing user work.
    if (createdWorktree)
      fs.rmSync(worktreePath, { recursive: true, force: true });
    if (createdRepo) fs.rmSync(repoPath, { recursive: true, force: true });
    if (createdRemote) fs.rmSync(remotePath, { recursive: true, force: true });
    const detail = error.stderr
      ? error.stderr.toString().trim()
      : error.message;
    throw new Error(`Creazione della demo non riuscita: ${detail}`);
  }
}

module.exports = { createDemo };

if (require.main === module) {
  const baseDir =
    process.argv[2] ||
    path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "Branchline",
      "demo",
    );
  createDemo(baseDir)
    .then((repoPath) => console.log(repoPath))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
