/* Copyright (C) 2026 Davide Leopardi
 * SPDX-License-Identifier: GPL-3.0-only */

const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  Menu,
  protocol,
  net,
  safeStorage,
} = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { randomUUID } = require("node:crypto");
const { GitService } = require("./git.cjs");
const { AIService } = require("./ai.cjs");
const { ProviderService } = require("./providers.cjs");
const { AIVault } = require("./ai-vault.cjs");
const { profilesFromFile } = require("./ai-import.cjs");
const { saveSettings } = require("./settings.cjs");
const { createDemo } = require("../scripts/demo.cjs");
const {
  LANGUAGES,
  normalizeLanguage,
  translate,
} = require("../locales/runtime.mjs");
const tr = (key, params) =>
  translate(store?.settings.language || "en", key, params);
protocol.registerSchemesAsPrivileged([
  {
    scheme: "branchline",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
app.setName("Branchline");
if (process.env.BRANCHLINE_DATA_DIR)
  app.setPath("userData", path.resolve(process.env.BRANCHLINE_DATA_DIR));
// Finder-launched apps inherit a sparse PATH; preserve user's credentials/SSH agent.
process.env.PATH = [
  ...new Set([
    process.env.PATH || "",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ]),
].join(":");
const defaults = {
  theme: "dark",
  fontSize: 13,
  autoFetch: false,
  autoStash: true,
  showRemoteBranches: true,
  defaultPath: "",
  identityName: "",
  identityEmail: "",
  language: "en",
};
let win, store, storePath, ai, providers;
let fetching = false;
const terminals = new Map();
const redacted = (text) =>
  String(text || "")
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, "$1[credentials]@")
    .replace(
      /(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g,
      "[redacted]",
    );
function persist() {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  const tmp = storePath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, storePath);
}
function emit(event, data) {
  if (win && !win.isDestroyed()) win.webContents.send(event, data);
}
const git = new GitService((entry) => {
  if (!store) return;
  store.activity.unshift({
    id: randomUUID(),
    time: new Date().toISOString(),
    ...entry,
    command: redacted(entry.command),
    output: redacted(entry.output),
  });
  store.activity = store.activity.slice(0, 250);
  persist();
});
async function register(repo) {
  const snapshot = await git.snapshot(repo);
  store.repos = [
    { path: snapshot.path, name: snapshot.name },
    ...store.repos.filter((r) => r.path !== snapshot.path),
  ].slice(0, 40);
  store.activeRepo = snapshot.path;
  persist();
  return snapshot;
}
async function allowed(repo) {
  if (typeof repo !== "string")
    throw new Error(tr("Percorso repository obbligatorio"));
  const real = await fsp.realpath(repo);
  if (!store.repos.some((r) => r.path === real))
    throw new Error(tr("Apri prima il repository con il selettore."));
  return real;
}
async function importAI(filename, harness = false) {
  let entries = await profilesFromFile(filename);
  if (harness) {
    const gateway = entries.find(
      (entry) => entry.profile.provider === "litellm",
    );
    if (!gateway)
      throw new Error(
        tr(
          "La configurazione Harness OS non contiene un gateway LiteLLM con una chiave valida.",
        ),
      );
    entries = [
      {
        ...gateway,
        profile: {
          ...gateway.profile,
          id: "harness-os",
          name: "Harness OS · Gemini 3.5 Flash",
          model: "gemini-3.5-flash",
        },
      },
    ];
  }
  for (const entry of entries) await ai.save(entry.profile, entry.credentials);
  const chosen = harness
    ? entries[0]
    : entries.find((entry) => entry.profile.model);
  if (chosen?.profile.model)
    await ai.activate(chosen.profile.id, chosen.profile.model);
  return ai.settings();
}
async function importHarnessAI(sourcePath) {
  let filename = sourcePath;
  if (filename === undefined) {
    const choice = await dialog.showOpenDialog(win, {
      title: tr("Seleziona la configurazione Harness OS da importare"),
      properties: ["openFile", "showHiddenFiles"],
      filters: [
        { name: tr("Profili JSON e ambiente"), extensions: ["json", "env"] },
        { name: tr("Tutti i file"), extensions: ["*"] },
      ],
    });
    if (choice.canceled || !choice.filePaths.length) return ai.settings();
    filename = choice.filePaths[0];
  }
  if (
    typeof filename !== "string" ||
    !path.isAbsolute(filename) ||
    filename.includes("\0")
  )
    throw new Error(tr("Seleziona un file locale valido."));
  return importAI(filename, true);
}
async function invoke(method, p = {}) {
  if (!p || typeof p !== "object" || Array.isArray(p))
    throw new Error(tr("Argomenti non validi"));
  switch (method) {
    case "app.bootstrap":
      return { ...store, version: app.getVersion() };
    case "app.activity":
      return store.activity;
    case "ai.settings":
      return ai.settings();
    case "provider.settings":
      return providers.settings();
    case "provider.save":
      return providers.save(p.profile, p.credentials);
    case "provider.delete":
      return providers.delete(p.id);
    case "ai.save":
      return ai.save(p.profile, p.credentials);
    case "ai.remove":
      return ai.remove(p.id);
    case "ai.activate":
      return ai.activate(p.id, p.model);
    case "ai.models":
      return ai.models(p.profileId);
    case "ai.test":
      return ai.test(p.profileId, p.model);
    case "ai.importHarness":
      return importHarnessAI(p.sourcePath);
    case "ai.import": {
      let filename = p.sourcePath;
      if (!filename) {
        const choice = await dialog.showOpenDialog(win, {
          title: tr("Importa profili e credenziali AI"),
          properties: ["openFile", "showHiddenFiles"],
          filters: [
            {
              name: tr("Profili JSON e ambiente"),
              extensions: ["json", "env"],
            },
            { name: tr("Tutti i file"), extensions: ["*"] },
          ],
        });
        if (choice.canceled) return ai.settings();
        filename = choice.filePaths[0];
      }
      if (typeof filename !== "string" || !path.isAbsolute(filename))
        throw new Error(tr("Seleziona un file locale valido."));
      return importAI(filename);
    }
    case "app.selectDirectory": {
      const choice = await dialog.showOpenDialog(win, {
        properties: ["openDirectory", "createDirectory"],
      });
      return choice.canceled ? null : choice.filePaths[0];
    }
    case "app.demo":
      return register(
        await createDemo(path.join(app.getPath("userData"), "demo")),
      );
    case "app.settings": {
      const s = p.settings || {};
      if (s.theme !== undefined && !["dark", "light"].includes(s.theme))
        throw new Error(tr("Tema non valido"));
      if (
        s.fontSize !== undefined &&
        (!Number.isFinite(s.fontSize) || s.fontSize < 11 || s.fontSize > 20)
      )
        throw new Error(tr("Dimensione carattere: 11–20"));
      for (const k of ["autoFetch", "autoStash", "showRemoteBranches"])
        if (s[k] !== undefined && typeof s[k] !== "boolean")
          throw new Error(tr("Impostazione non valida: {name}", { name: k }));
      for (const k of [
        "defaultPath",
        "identityName",
        "identityEmail",
        "language",
      ])
        if (
          s[k] !== undefined &&
          (typeof s[k] !== "string" || s[k].length > 4096)
        )
          throw new Error(tr("Impostazione non valida: {name}", { name: k }));
      if (
        s.language !== undefined &&
        !LANGUAGES.some((option) => option.code === s.language)
      )
        throw new Error(tr("Lingua non supportata"));
      saveSettings(store, s, Object.keys(defaults), persist);
      installMenu();
      return store.settings;
    }
    case "app.reveal": {
      const repo = await allowed(p.path);
      shell.showItemInFolder(repo);
      return;
    }
    case "app.external": {
      const url = new URL(p.url);
      if (url.protocol !== "https:" || url.username || url.password)
        throw new Error(
          tr("Sono consentiti solo link HTTPS senza credenziali."),
        );
      await shell.openExternal(url.href);
      return;
    }
    case "repo.open":
      return register(p.path);
    case "repo.init":
      await git.init(p.path);
      return register(p.path);
    case "repo.clone":
      await git.clone(p.url, p.destination);
      return register(p.destination);
    case "repo.close":
      store.repos = store.repos.filter((r) => r.path !== p.path);
      if (store.activeRepo === p.path)
        store.activeRepo = store.repos[0]?.path || null;
      persist();
      return;
    case "terminal.write": {
      const t = terminals.get(p.id);
      if (!t) throw new Error(tr("Terminale chiuso"));
      t.write(String(p.data));
      return;
    }
    case "terminal.resize": {
      const t = terminals.get(p.id);
      if (t)
        t.resize(
          Math.max(2, Math.min(500, Math.floor(p.cols))),
          Math.max(2, Math.min(200, Math.floor(p.rows))),
        );
      return;
    }
    case "terminal.close": {
      const t = terminals.get(p.id);
      if (t) t.kill();
      terminals.delete(p.id);
      return;
    }
  }
  const repo = await allowed(p.path);
  switch (method) {
    case "repo.snapshot":
      return git.snapshot(repo, p.limit, p.focusRef);
    case "repo.diff":
      return git.diff(repo, p);
    case "repo.commitDetails":
      return git.commitDetails(repo, p.hash);
    case "repo.file":
      return git.file(repo, p.file, p.ref);
    case "repo.blame":
      return git.blame(repo, p.file, p.ref);
    case "repo.history":
      return git.history(repo, p.file);
    case "repo.conflictVersions":
      return git.conflictVersions(repo, p.file);
    case "repo.rebasePlan":
      return git.rebasePlan(repo, p.base);
    case "ai.status": {
      const config = await ai.settings();
      const profile = config.profiles.find(
        (item) => item.id === config.activeProfileId,
      );
      if (!profile)
        return {
          available: false,
          models: [],
          message: tr("Configura un profilo nelle impostazioni AI."),
        };
      const result = await ai.models(profile.id);
      return { available: true, ...result };
    }
    case "ai.generate":
      return ai.generate(p);
    case "repo.action": {
      const options = { ...p };
      if (
        [
          "branch.checkout",
          "commit.checkout",
          "merge",
          "rebase",
          "pull",
        ].includes(p.operation) &&
        options.autoStash === undefined
      )
        options.autoStash = store.settings.autoStash ?? true;
      try {
        return await git.action(repo, p.operation, options);
      } finally {
        emit("repo.changed", { path: repo });
      }
    }
    case "provider.status":
    case "provider.test":
      return providers.status(repo, p);
    case "provider.prs":
      return providers.list(repo, "prs", p);
    case "provider.issues":
      return providers.list(repo, "issues", p);
    case "provider.bind":
      return providers.bind(repo, p.remote, p.profileId);
    case "terminal.open": {
      let pty;
      try {
        pty = require("node-pty");
      } catch (e) {
        throw new Error(
          "Terminale nativo non disponibile: esegui npm install e npm run package. " +
            e.message,
        );
      }
      const id = randomUUID();
      const terminal = pty.spawn(process.env.SHELL || "/bin/zsh", ["-l"], {
        name: "xterm-256color",
        cols: 100,
        rows: 18,
        cwd: repo,
        env: { ...process.env, TERM: "xterm-256color" },
      });
      terminals.set(id, terminal);
      terminal.onData((data) => emit("terminal.data", { id, data }));
      terminal.onExit(({ exitCode }) => {
        terminals.delete(id);
        emit("terminal.exit", { id, code: exitCode });
      });
      return { id };
    }
    default:
      throw new Error(tr("Metodo non riconosciuto: {name}", { name: method }));
  }
}
function makeWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1100,
    minHeight: 700,
    title: "Branchline",
    backgroundColor: "#171b22",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 18 },
    icon: path.join(__dirname, "../assets/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const dev = process.env.BRANCHLINE_DEV_URL;
  const valid = (url) =>
    dev ? url.startsWith(dev + "/") : url.startsWith("branchline://app/");
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e, url) => {
    if (!valid(url)) e.preventDefault();
  });
  if (dev) win.loadURL(dev);
  else win.loadURL("branchline://app/index.html");
  win.on("closed", () => {
    win = null;
    for (const t of terminals.values()) t.kill();
    terminals.clear();
  });
}
function installMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Branchline",
        submenu: [
          { role: "about", label: tr("Informazioni su Branchline") },
          { type: "separator" },
          {
            label: tr("Impostazioni…"),
            accelerator: "CmdOrCtrl+,",
            click: () => emit("app.command", "settings"),
          },
          { type: "separator" },
          { role: "hide", label: tr("Nascondi Branchline") },
          { role: "hideOthers", label: tr("Nascondi altre applicazioni") },
          { role: "unhide", label: tr("Mostra tutte") },
          { type: "separator" },
          { role: "quit", label: tr("Esci da Branchline") },
        ],
      },
      {
        label: tr("File"),
        submenu: [
          {
            label: tr("Apri repository…"),
            accelerator: "CmdOrCtrl+O",
            click: () => emit("app.command", "open"),
          },
          {
            label: tr("Palette comandi"),
            accelerator: "CmdOrCtrl+K",
            click: () => emit("app.command", "palette"),
          },
          { type: "separator" },
          { role: "close", label: tr("Chiudi finestra") },
        ],
      },
      {
        label: tr("Modifica"),
        submenu: [
          { role: "undo", label: tr("Annulla modifica") },
          { role: "redo", label: tr("Ripeti") },
          { type: "separator" },
          { role: "cut", label: tr("Taglia") },
          { role: "copy", label: tr("Copia") },
          { role: "paste", label: tr("Incolla") },
          { role: "selectAll", label: tr("Seleziona tutto") },
        ],
      },
      {
        label: tr("Vista"),
        submenu: [
          { role: "reload", label: tr("Ricarica") },
          { role: "toggleDevTools", label: tr("Strumenti sviluppatore") },
          { type: "separator" },
          { role: "resetZoom", label: tr("Dimensioni effettive") },
          { role: "zoomIn", label: tr("Ingrandisci") },
          { role: "zoomOut", label: tr("Riduci") },
          { role: "togglefullscreen", label: tr("Schermo intero") },
        ],
      },
      {
        label: tr("Finestra"),
        submenu: [
          { role: "minimize", label: tr("Riduci a icona") },
          { role: "zoom", label: tr("Zoom finestra") },
          { role: "front", label: tr("Porta tutte in primo piano") },
        ],
      },
    ]),
  );
}
app.whenReady().then(() => {
  storePath = path.join(app.getPath("userData"), "state.json");
  try {
    store = JSON.parse(fs.readFileSync(storePath, "utf8"));
  } catch {
    store = { repos: [], activeRepo: null, settings: defaults, activity: [] };
  }
  const aiDirectory = path.join(app.getPath("userData"), "ai");
  ai = new AIService({
    file: path.join(aiDirectory, "profiles.json"),
    vault: new AIVault({ directory: aiDirectory, safeStorage }),
  });
  const hostingDirectory = path.join(app.getPath("userData"), "hosting");
  providers = new ProviderService({
    file: path.join(hostingDirectory, "profiles.json"),
    vault: new AIVault({ directory: hostingDirectory, safeStorage }),
  });
  store.settings = { ...defaults, ...store.settings };
  store.settings.language = normalizeLanguage(store.settings.language);
  store.activity ||= [];
  store.repos ||= [];
  protocol.handle("branchline", (req) => {
    const parsed = new URL(req.url);
    if (parsed.hostname !== "app")
      return new Response("Forbidden", { status: 403 });
    const pathname = decodeURIComponent(parsed.pathname);
    const target = path.resolve(__dirname, "../dist", "." + pathname);
    const root = path.resolve(__dirname, "../dist");
    if (!target.startsWith(root + path.sep))
      return new Response("Forbidden", { status: 403 });
    return net.fetch(pathToFileURL(target).toString());
  });
  ipcMain.handle("branchline:invoke", async (event, method, payload) => {
    if (
      !win ||
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame
    )
      throw new Error(tr("Origine non autorizzata"));
    try {
      return await invoke(method, payload);
    } catch (e) {
      throw new Error(redacted(e.message));
    }
  });
  app.on("web-contents-created", (_, contents) =>
    contents.session.setPermissionRequestHandler((sender, permission, cb) =>
      cb(
        sender === win?.webContents &&
          permission === "clipboard-sanitized-write",
      ),
    ),
  );
  installMenu();
  makeWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) makeWindow();
  });
  const fetchTimer = setInterval(async () => {
    if (fetching || !store.settings.autoFetch || !store.activeRepo) return;
    fetching = true;
    try {
      const repo = await allowed(store.activeRepo);
      const snap = await git.snapshot(repo, 1);
      if (snap.remotes.length) {
        await git.action(repo, "fetch", { prune: true });
        emit("repo.changed", { path: repo });
      }
    } catch {
    } finally {
      fetching = false;
    }
  }, 120000);
  fetchTimer.unref();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
