import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  useLayoutEffect,
} from "react";
import {
  GitBranch,
  GitMerge,
  GitCommitHorizontal,
  GitPullRequest,
  GitFork,
  ArrowDownToLine,
  ArrowUpFromLine,
  RefreshCw,
  Undo2,
  Redo2,
  Plus,
  Minus,
  Search,
  Terminal,
  Settings as SettingsIcon,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  FolderOpen,
  FolderGit2,
  FolderPlus,
  Tag,
  Layers,
  Clock3,
  Sun,
  Moon,
  X,
  Check,
  CheckCheck,
  AlertTriangle,
  ArrowUpRight,
  Copy,
  Code2,
  FileText,
  FileCode2,
  PanelRightClose,
  PanelRightOpen,
  Command,
  History,
  Cloud,
  ExternalLink,
  Link2,
  Trash2,
  Download,
  Inbox,
  ArrowLeft,
  Maximize2,
  ShieldCheck,
  CheckCircle2,
  LoaderCircle,
  Square,
  Package,
  Play,
  BookOpen,
  CornerDownLeft,
  Network,
  User,
  FileDiff,
} from "lucide-react";
import Graph, { buildGraph, type GraphRowMetric } from "./Graph";
import CommitMarkdown, { displayCommitText } from "./CommitText";
import TerminalPanel from "./Terminal";
import ToolsPanel from "./Tools";
import AISettings from "./AISettings";
import HostingSettings, { HostingIntegration } from "./HostingSettings";
import ConflictPanel from "./Conflict";
import type {
  Snapshot,
  Bootstrap,
  CommitDetails,
  FileChange,
  Activity,
  Settings,
  Payload,
  Commit,
} from "./types";

type Field = {
  name: string;
  label: string;
  placeholder?: string;
  type?: "text" | "textarea" | "checkbox" | "select";
  options?: string[];
  required?: boolean;
  default?: string | boolean;
};
type Action = {
  id: string;
  title: string;
  group: string;
  description: string;
  fields?: Field[];
  danger?: boolean;
};
const field = (
  name: string,
  label: string,
  placeholder = "",
  required = true,
): Field => ({ name, label, placeholder, required });
const actions: Action[] = [
  {
    id: "branch.create",
    title: "Crea branch",
    group: "Branch",
    description: "Un nuovo ramo per il tuo lavoro.",
    fields: [
      field("name", "Nome branch", "feature/nuova-idea"),
      field("start", "Punto di partenza", "HEAD", false),
      {
        name: "checkout",
        label: "Passa al nuovo branch",
        type: "checkbox",
        default: true,
      },
    ],
  },
  {
    id: "branch.checkout",
    title: "Cambia branch",
    group: "Branch",
    description: "Sposta il working tree sul branch selezionato.",
    fields: [field("name", "Branch", "main")],
  },
  {
    id: "commit.checkout",
    title: "Apri questo commit",
    group: "Cronologia",
    description:
      "Esplora il repository a questo punto della cronologia. Git passerà in detached HEAD: i nuovi commit non apparterranno a un branch finché non ne crei uno.",
    fields: [field("hash", "Commit")],
  },
  {
    id: "branch.rename",
    title: "Rinomina branch",
    group: "Branch",
    description: "Rinomina un branch locale.",
    fields: [field("name", "Branch attuale"), field("newName", "Nuovo nome")],
  },
  {
    id: "branch.delete",
    title: "Elimina branch",
    group: "Branch",
    description: "Elimina il riferimento locale del branch.",
    danger: true,
    fields: [
      field("name", "Branch"),
      {
        name: "force",
        label: "Elimina anche se non è stato unito",
        type: "checkbox",
      },
    ],
  },
  {
    id: "merge",
    title: "Merge",
    group: "Cronologia",
    description: "Unisci un branch nel branch attualmente aperto.",
    fields: [
      field("ref", "Branch da unire", "feature/nome"),
      {
        name: "squash",
        label: "Squash: prepara tutte le modifiche come un singolo commit",
        type: "checkbox",
      },
    ],
  },
  {
    id: "rebase",
    title: "Rebase",
    group: "Cronologia",
    description:
      "Riscrive i commit del branch attuale sopra il riferimento scelto.",
    danger: true,
    fields: [field("ref", "Nuova base", "main")],
  },
  {
    id: "cherryPick",
    title: "Cherry-pick commit",
    group: "Cronologia",
    description: "Applica le modifiche di un commit al branch attuale.",
    fields: [field("hash", "Commit")],
  },
  {
    id: "revert",
    title: "Revert commit",
    group: "Cronologia",
    description: "Crea un nuovo commit che annulla le modifiche selezionate.",
    fields: [field("hash", "Commit")],
  },
  {
    id: "reset",
    title: "Reset branch",
    group: "Cronologia",
    description:
      "Sposta il branch sul commit scelto. Hard elimina le modifiche locali ai file tracciati.",
    danger: true,
    fields: [
      field("ref", "Riferimento", "HEAD~1"),
      {
        name: "mode",
        label: "Modalità",
        type: "select",
        options: ["soft", "mixed", "hard"],
        default: "mixed",
      },
    ],
  },
  {
    id: "undo",
    title: "Annulla ultima operazione",
    group: "Cronologia",
    description:
      "Annulla l’ultimo commit o reset eseguito da Branchline, se il repository è ancora nello stato previsto.",
  },
  {
    id: "redo",
    title: "Ripeti ultima operazione",
    group: "Cronologia",
    description:
      "Ripete l’operazione annullata, se il repository è ancora nello stato previsto.",
  },
  {
    id: "fetch",
    title: "Fetch",
    group: "Remote",
    description: "Scarica gli aggiornamenti dai remote.",
    fields: [
      field("remote", "Remote", "origin", false),
      {
        name: "prune",
        label: "Rimuovi riferimenti remoti non più esistenti",
        type: "checkbox",
        default: true,
      },
    ],
  },
  {
    id: "pull",
    title: "Pull",
    group: "Remote",
    description: "Scarica e integra gli aggiornamenti del branch remoto.",
    fields: [
      field("remote", "Remote", "origin", false),
      {
        name: "rebase",
        label: "Usa rebase per integrare le modifiche",
        type: "checkbox",
      },
    ],
  },
  {
    id: "push",
    title: "Push",
    group: "Remote",
    description: "Pubblica il branch sul remote scelto.",
    fields: [
      field("remote", "Remote", "origin", false),
      field("branch", "Branch", "", false),
      {
        name: "setUpstream",
        label: "Imposta il branch remoto come upstream",
        type: "checkbox",
      },
      {
        name: "force",
        label: "Force push protetto (--force-with-lease)",
        type: "checkbox",
      },
    ],
  },
  {
    id: "stash.create",
    title: "Crea stash",
    group: "Stash",
    description: "Metti da parte le modifiche locali e libera il working tree.",
    fields: [
      field("message", "Descrizione", "Lavoro in corso", false),
      {
        name: "includeUntracked",
        label: "Includi i file non tracciati",
        type: "checkbox",
        default: true,
      },
    ],
  },
  {
    id: "stash.apply",
    title: "Applica stash",
    group: "Stash",
    description: "Applica lo stash conservandolo nell’elenco.",
    fields: [
      field("ref", "Stash", "stash@{0}"),
      {
        name: "index",
        label: "Ripristina anche la preparazione dei file nello staging",
        type: "checkbox",
      },
    ],
  },
  {
    id: "stash.pop",
    title: "Ripristina stash",
    group: "Stash",
    description: "Applica lo stash e rimuovilo se l’applicazione riesce.",
    fields: [field("ref", "Stash", "stash@{0}")],
  },
  {
    id: "stash.drop",
    title: "Elimina stash",
    group: "Stash",
    description: "Elimina definitivamente il riferimento allo stash.",
    danger: true,
    fields: [field("ref", "Stash", "stash@{0}")],
  },
  {
    id: "tag.create",
    title: "Crea tag",
    group: "Tag",
    description: "Segna una versione nella cronologia.",
    fields: [
      field("name", "Nome tag", "v1.0.0"),
      field("ref", "Commit", "HEAD", false),
      field("message", "Messaggio (annotated tag)", "", false),
    ],
  },
  {
    id: "tag.delete",
    title: "Elimina tag",
    group: "Tag",
    description: "Elimina un tag locale.",
    danger: true,
    fields: [field("name", "Tag")],
  },
  {
    id: "remote.add",
    title: "Aggiungi remote",
    group: "Remote",
    description: "Collega il repository a un server Git.",
    fields: [
      field("name", "Nome", "origin"),
      field("url", "URL", "git@github.com:team/repo.git"),
    ],
  },
  {
    id: "remote.setUrl",
    title: "Modifica URL remote",
    group: "Remote",
    description: "Aggiorna l’indirizzo del remote.",
    fields: [field("name", "Remote", "origin"), field("url", "Nuovo URL")],
  },
  {
    id: "remote.remove",
    title: "Rimuovi remote",
    group: "Remote",
    description:
      "Rimuove il remote e i suoi riferimenti dal repository locale.",
    danger: true,
    fields: [field("name", "Remote", "origin")],
  },
  {
    id: "worktree.add",
    title: "Aggiungi worktree",
    group: "Workspace",
    description: "Lavora su un altro branch in una cartella separata.",
    fields: [
      field("destination", "Cartella", "/percorso/worktree"),
      field("branch", "Branch esistente", "", false),
      field("newBranch", "Oppure crea un nuovo branch", "", false),
    ],
  },
  {
    id: "worktree.remove",
    title: "Rimuovi worktree",
    group: "Workspace",
    description: "Rimuove un worktree pulito e la relativa cartella.",
    danger: true,
    fields: [field("destination", "Cartella del worktree")],
  },
  {
    id: "identity",
    title: "Identità Git",
    group: "Workspace",
    description: "Imposta nome ed email per i commit in questo repository.",
    fields: [
      field("name", "Nome", "Mario Rossi"),
      field("email", "Email", "mario@example.com"),
    ],
  },
  {
    id: "gitflow.init",
    title: "Inizializza Git Flow",
    group: "Git Flow",
    description: "Prepara i branch principali per il flusso Git Flow.",
    fields: [
      { ...field("main", "Branch di produzione"), default: "main" },
      { ...field("develop", "Branch di sviluppo"), default: "develop" },
    ],
  },
  {
    id: "gitflow.start",
    title: "Avvia Git Flow",
    group: "Git Flow",
    description: "Crea un feature, release o hotfix branch.",
    fields: [
      {
        name: "kind",
        label: "Tipo",
        type: "select",
        options: ["feature", "release", "hotfix"],
        default: "feature",
      },
      field("name", "Nome"),
    ],
  },
  {
    id: "gitflow.finish",
    title: "Completa Git Flow",
    group: "Git Flow",
    description: "Integra il branch nel flusso Git Flow e chiudi il lavoro.",
    fields: [
      {
        name: "kind",
        label: "Tipo",
        type: "select",
        options: ["feature", "release", "hotfix"],
        default: "feature",
      },
      field("name", "Nome"),
    ],
  },
  {
    id: "submodule.add",
    title: "Aggiungi submodule",
    group: "Workspace",
    description: "Collega un altro repository come submodule.",
    fields: [
      field("url", "URL Git"),
      field("destination", "Cartella relativa", "vendor/library"),
    ],
  },
  {
    id: "submodule.update",
    title: "Aggiorna submodule",
    group: "Workspace",
    description: "Inizializza e aggiorna i submodule alla versione registrata.",
  },
  {
    id: "ignore",
    title: "Ignora file",
    group: "File",
    description:
      "Aggiunge regole precise al .gitignore. Un file già tracciato continua a esserlo.",
    fields: [field("filesText", "File, uno per riga")],
  },
  {
    id: "untrack",
    title: "Smetti di tracciare file",
    group: "File",
    description:
      "Rimuove i file dall’indice Git conservando il contenuto sul disco.",
    fields: [field("filesText", "File, uno per riga")],
  },
  {
    id: "discard.restore",
    title: "Recupera modifiche scartate",
    group: "File",
    description:
      "Ripristina una copia locale creata prima di scartare le modifiche. Trovi l’ID nel registro attività.",
    fields: [field("backup", "ID della copia di recupero")],
  },
  {
    id: "worktree.lock",
    title: "Blocca worktree",
    group: "Workspace",
    description: "Protegge un worktree dalla rimozione automatica.",
    fields: [field("destination", "Cartella del worktree")],
  },
  {
    id: "worktree.unlock",
    title: "Sblocca worktree",
    group: "Workspace",
    description: "Rimuove il blocco di un worktree.",
    fields: [field("destination", "Cartella del worktree")],
  },
  {
    id: "lfs.status",
    title: "Stato Git LFS",
    group: "Workspace",
    description:
      "Mostra lo stato dei file gestiti da Git LFS. Richiede Git LFS installato.",
  },
  {
    id: "lfs.track",
    title: "Traccia file con Git LFS",
    group: "File",
    description:
      "Aggiunge il file alle regole Git LFS in .gitattributes. Richiede Git LFS installato.",
    fields: [field("file", "File")],
  },
  {
    id: "discard",
    title: "Scarta modifiche",
    group: "File",
    description:
      "Scarta le modifiche ai file selezionati, inclusi i file non tracciati. Prima dell’operazione viene creata una copia di recupero locale.",
    danger: true,
  },
  {
    id: "conflict.resolve",
    title: "Risolvi conflitto",
    group: "File",
    description:
      "Scegli il contenuto da conservare o scrivi la versione risolta. Il file viene aggiunto allo staging.",
    fields: [
      field("file", "File"),
      {
        name: "strategy",
        label: "Versione",
        type: "select",
        options: ["ours", "theirs", "manuale"],
        default: "ours",
      },
      {
        name: "content",
        label: "Contenuto risolto (solo manuale)",
        type: "textarea",
        required: false,
      },
    ],
  },
  {
    id: "operation.continue",
    title: "Continua operazione",
    group: "Cronologia",
    description: "Continua dopo aver risolto i conflitti.",
    fields: [
      {
        name: "kind",
        label: "Operazione",
        type: "select",
        options: ["merge", "rebase", "cherry-pick", "revert"],
      },
    ],
  },
  {
    id: "operation.abort",
    title: "Interrompi operazione",
    group: "Cronologia",
    description:
      "Annulla l’operazione Git in corso e ripristina lo stato precedente.",
    danger: true,
    fields: [
      {
        name: "kind",
        label: "Operazione",
        type: "select",
        options: ["merge", "rebase", "cherry-pick", "revert"],
      },
    ],
  },
];
const autoStashOperations = new Set([
  "branch.checkout",
  "commit.checkout",
  "merge",
  "rebase",
  "pull",
]);
for (const action of actions)
  if (autoStashOperations.has(action.id))
    action.fields = [
      ...(action.fields || []),
      {
        name: "autoStash",
        label:
          "Conserva e ripristina automaticamente le modifiche locali (autostash)",
        type: "checkbox",
      },
    ];
type AutoStashInfo = {
  hash: string;
  ref: string;
  restored: boolean;
  conflict: boolean;
  operation?: string;
  originalBranch?: string;
  originalHead?: string;
  awaitingOperation?: string | null;
};
type HistorySnapshot = Snapshot & {
  historyFocus?: string | null;
  historyLimited?: boolean;
};
function relative(date: string) {
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) return date;
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  return days === 0
    ? "Oggi"
    : days === 1
      ? "Ieri"
      : days < 7
        ? `${days} giorni fa`
        : d.toLocaleDateString("it-IT", { day: "2-digit", month: "short" });
}
function avatar(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .toUpperCase();
}
function gitCommandBase(id: string, v: Payload) {
  const quote = (x: unknown) => `'${String(x ?? "").replace(/'/g, "'\\''")}'`;
  const val = (key: string, fallback = "") => quote(v[key] || fallback);
  const flag = (key: string, text: string) => (v[key] ? ` ${text}` : "");
  switch (id) {
    case "branch.create":
      return `git ${v.checkout ? "switch -c" : "branch"} ${val("name")}${v.start ? " " + val("start") : ""}`;
    case "branch.checkout":
      return `git switch ${val("name")}`;
    case "commit.checkout":
      return `git switch --detach ${val("hash")}`;
    case "branch.rename":
      return `git branch -m ${val("name")} ${val("newName")}`;
    case "branch.delete":
      return `git branch ${v.force ? "-D" : "-d"} ${val("name")}`;
    case "merge":
      return `git merge${flag("squash", "--squash")} ${val("ref")}`;
    case "rebase":
      return `git rebase ${val("ref")}`;
    case "cherryPick":
      return `git cherry-pick ${val("hash")}`;
    case "revert":
      return `git revert --no-edit ${val("hash")}`;
    case "reset":
      return `git reset --${v.mode || "mixed"} ${val("ref")}`;
    case "fetch":
      return `git fetch${flag("prune", "--prune")} ${v.remote ? val("remote") : "--all"}`;
    case "pull":
      return `git pull${flag("rebase", "--rebase")}${v.remote ? " " + val("remote") : ""}`;
    case "push":
      return `git push${flag("force", "--force-with-lease")}${flag("setUpstream", "--set-upstream")}${v.remote ? " " + val("remote") : ""}${v.branch ? " " + val("branch") : ""}`;
    case "stash.create":
      return `git stash push${flag("includeUntracked", "--include-untracked")}${v.message ? " -m " + val("message") : ""}`;
    case "stash.apply":
    case "stash.pop":
    case "stash.drop":
      return `git stash ${id.split(".")[1]} ${val("ref")}`;
    case "tag.create":
      return `git tag${v.message ? " -a" : ""} ${val("name")} ${val("ref", "HEAD")}${v.message ? " -m " + val("message") : ""}`;
    case "tag.delete":
      return `git tag -d ${val("name")}`;
    case "remote.add":
      return `git remote add ${val("name")} ${val("url")}`;
    case "remote.setUrl":
      return `git remote set-url ${val("name")} ${val("url")}`;
    case "remote.remove":
      return `git remote remove ${val("name")}`;
    case "worktree.add":
      return `git worktree add${v.newBranch ? " -b " + val("newBranch") : ""} ${val("destination")}${v.branch ? " " + val("branch") : ""}`;
    case "worktree.remove":
      return `git worktree remove ${val("destination")}`;
    case "ignore":
      return `Aggiungi a .gitignore i file selezionati: ${v.filesText || ""}`;
    case "untrack":
      return `git rm --cached -- ${String(v.filesText || "")
        .split("\n")
        .map(quote)
        .join(" ")}`;
    case "discard.restore":
      return `Ripristina copia di recupero ${val("backup")}`;
    case "worktree.lock":
    case "worktree.unlock":
      return `git worktree ${id.split(".")[1]} ${val("destination")}`;
    case "lfs.status":
      return "git lfs status";
    case "lfs.track":
      return `git lfs track -- ${val("file")}`;
    case "identity":
      return `git config user.name ${val("name")}\ngit config user.email ${val("email")}`;
    case "operation.continue":
    case "operation.abort":
      return `git ${v.kind} --${id.split(".")[1]}`;
    case "submodule.add":
      return `git submodule add ${val("url")} ${val("destination")}`;
    case "submodule.update":
      return "git submodule update --init --recursive";
    case "conflict.resolve":
      return v.strategy === "manuale"
        ? `Scrivi contenuto risolto in ${val("file")}\ngit add -- ${val("file")}`
        : `git checkout --${v.strategy} -- ${val("file")}\ngit add -- ${val("file")}`;
    case "discard":
      return `Crea copia di recupero locale\ngit restore --worktree -- ${((v.files as string[]) || []).map(quote).join(" ")}\n# i file non tracciati selezionati vengono rimossi`;
    case "undo":
    case "redo":
      return "Ripristino protetto della precedente operazione locale";
    case "gitflow.init":
      return `Prepara branch ${val("main")} e ${val("develop")} e configurazione Git Flow`;
    case "gitflow.start":
      return `git switch -c ${quote(`${v.kind}/${v.name}`)} ${v.kind === "hotfix" ? "[branch produzione]" : "[branch sviluppo]"}`;
    case "gitflow.finish":
      return `Merge protetto di ${quote(`${v.kind}/${v.name}`)} nei branch Git Flow`;
    default:
      return `git ${id}`;
  }
}
function gitCommand(id: string, values: Payload) {
  const command = gitCommandBase(id, values);
  return values.autoStash
    ? `# Conserva staged, unstaged e file non tracciati; ripristina dopo l’operazione
${command}`
    : command;
}
function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [theme, setTheme] = useState<"dark" | "light">("dark");
  const [view, setView] = useState<
      "graph" | "changes" | "activity" | "integrations"
    >("graph"),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [details, setDetails] = useState<CommitDetails | null>(null),
    [rightOpen, setRightOpen] = useState(true),
    [terminal, setTerminal] = useState(false),
    [toolsOpen, setToolsOpen] = useState(false),
    [aiSettingsOpen, setAISettingsOpen] = useState(false),
    [aiSettingsVersion, setAISettingsVersion] = useState(0),
    [hostingSettingsOpen, setHostingSettingsOpen] = useState(false),
    [hostingRevision, setHostingRevision] = useState(0),
    [conflictFile, setConflictFile] = useState<string | null>(null);
  const [modal, setModal] = useState<{
      action?: Action;
      values: Payload;
      repoPath?: string;
      type?: "clone" | "init" | "settings";
    } | null>(null),
    [menu, setMenu] = useState<{
      x: number;
      y: number;
      items: {
        label: string;
        operation?: string;
        values?: Payload;
        fn?: () => void;
        danger?: boolean;
      }[];
    } | null>(null),
    [palette, setPalette] = useState(false),
    [paletteSearch, setPaletteSearch] = useState("");
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(
      null,
    ),
    [output, setOutput] = useState<{
      title: string;
      text: string;
      command?: string;
    } | null>(null),
    [activity, setActivity] = useState<Activity[]>([]);
  const [diff, setDiff] = useState<{
      text: string;
      title: string;
      file: string;
      staged: boolean;
      commit?: string;
    } | null>(null),
    [diffMode, setDiffMode] = useState<"unified" | "split">("unified"),
    [subject, setSubject] = useState(""),
    [description, setDescription] = useState(""),
    [amend, setAmend] = useState(false),
    [sign, setSign] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
      tags: true,
      stashes: false,
      worktrees: true,
    }),
    [repoFilter, setRepoFilter] = useState(""),
    [sidebarWide, setSidebarWide] = useState(false),
    [refsWidth, setRefsWidth] = useState(210),
    [graphRows, setGraphRows] = useState<GraphRowMetric[]>([]),
    [rawCommitMessage, setRawCommitMessage] = useState(false),
    [settingsDraft, setSettingsDraft] = useState<Partial<Settings>>({});
  const path = snapshot?.path;
  const livePath = useRef(path);
  livePath.current = path;
  const repoEpoch = useRef(0),
    refreshEpoch = useRef(0),
    selectionEpoch = useRef(0),
    diffEpoch = useRef(0),
    liveSelection = useRef(selected),
    historyFocusRef = useRef<string | null>(null),
    renderedFocusRef = useRef<string | null>(null),
    scrollTargetRef = useRef<string | null>(null),
    resizeCleanupRef = useRef<(() => void) | null>(null),
    graphSearchRef = useRef<HTMLInputElement>(null),
    graphContentRef = useRef<HTMLDivElement>(null);
  liveSelection.current = selected;
  const notify = useCallback(
    (text: string, error = false) => setToast({ text, error }),
    [],
  );
  const invoke = useCallback(<T,>(method: string, payload?: Payload) => {
    if (!window.branchline)
      throw new Error(
        "Apri Branchline come applicazione desktop per usare Git.",
      );
    return window.branchline.invoke<T>(method, payload);
  }, []);
  const refresh = useCallback(async () => {
    const currentPath = livePath.current;
    if (!currentPath) return;
    const token = ++refreshEpoch.current;
    const focusRef = historyFocusRef.current;
    try {
      const next = await invoke<Snapshot>("repo.snapshot", {
        path: currentPath,
        ...(focusRef ? { focusRef } : {}),
      });
      if (currentPath !== livePath.current || token !== refreshEpoch.current)
        return;
      setSnapshot(next);
      renderedFocusRef.current = focusRef;
      const currentSelection = liveSelection.current;
      if (currentSelection) {
        try {
          const result = await invoke<CommitDetails>("repo.commitDetails", {
            path: currentPath,
            hash: currentSelection,
          });
          if (
            currentPath === livePath.current &&
            currentSelection === liveSelection.current &&
            token === refreshEpoch.current
          )
            setDetails(result);
        } catch {
          if (
            currentPath === livePath.current &&
            currentSelection === liveSelection.current &&
            token === refreshEpoch.current
          ) {
            setSelected(null);
            setDetails(null);
          }
        }
      }
    } catch (e) {
      if (currentPath === livePath.current) notify(String(e), true);
    }
  }, [invoke, notify]);
  const openSnapshot = useCallback((data: Snapshot) => {
    livePath.current = data.path;
    liveSelection.current = null;
    historyFocusRef.current = null;
    renderedFocusRef.current = null;
    scrollTargetRef.current = null;
    refreshEpoch.current++;
    selectionEpoch.current++;
    diffEpoch.current++;
    setToolsOpen(false);
    setHostingSettingsOpen(false);
    setConflictFile(null);
    setModal(null);
    setMenu(null);
    setOutput(null);
    setPalette(false);
    setSubject("");
    setDescription("");
    setAmend(false);
    setSign(false);
    setSnapshot(data);
    setSearch("");
    setSelected(null);
    setDetails(null);
    setDiff(null);
    setView("graph");
    setBoot((b) =>
      b
        ? {
            ...b,
            activeRepo: data.path,
            repos: [
              { path: data.path, name: data.name },
              ...b.repos.filter((x) => x.path !== data.path),
            ],
          }
        : b,
    );
  }, []);
  const openRepo = useCallback(
    async (repoPath?: string) => {
      const token = ++repoEpoch.current;
      try {
        const chosen =
          repoPath || (await invoke<string | null>("app.selectDirectory"));
        if (!chosen || token !== repoEpoch.current) return;
        setBusy(true);
        const data = await invoke<Snapshot>("repo.open", { path: chosen });
        if (token === repoEpoch.current) openSnapshot(data);
      } catch (e) {
        if (token === repoEpoch.current) notify(String(e), true);
      } finally {
        if (token === repoEpoch.current) setBusy(false);
      }
    },
    [invoke, openSnapshot, notify],
  );
  const openDemo = useCallback(async () => {
    const token = ++repoEpoch.current;
    setBusy(true);
    try {
      const data = await invoke<Snapshot>("app.demo");
      if (token === repoEpoch.current) {
        openSnapshot(data);
        notify("Demo pronta: repository locale isolato");
      }
    } catch (e) {
      if (token === repoEpoch.current) notify(String(e), true);
    } finally {
      if (token === repoEpoch.current) setBusy(false);
    }
  }, [invoke, openSnapshot, notify]);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const token = repoEpoch.current;
        const result = await invoke<Bootstrap>("app.bootstrap");
        if (!active) return;
        setBoot(result);
        setTheme(result.settings.theme);
        setActivity(result.activity);
        if (result.activeRepo && token === repoEpoch.current) {
          try {
            const repo = await invoke<Snapshot>("repo.open", {
              path: result.activeRepo,
            });
            if (active && token === repoEpoch.current) {
              livePath.current = repo.path;
              setSnapshot(repo);
            }
          } catch (e) {
            notify(String(e), true);
          }
        }
      } catch (e) {
        notify(String(e), true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [invoke, notify]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(
    () =>
      window.branchline?.on("repo.changed", (event: { path: string }) => {
        if (event.path === livePath.current) void refresh();
      }),
    [refresh],
  );
  useEffect(
    () =>
      window.branchline?.on("app.command", (command: string) => {
        if (command === "open") void openRepo();
        if (command === "palette") {
          setPalette(true);
          setPaletteSearch("");
        }
        if (command === "settings") {
          setSettingsDraft(boot?.settings || {});
          setModal({ type: "settings", values: {} });
        }
      }),
    [openRepo, boot],
  );
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.error ? 9000 : 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const focus = () => {
      void refresh();
    };
    window.addEventListener("focus", focus);
    const timer = setInterval(() => {
      if (livePath.current) void refresh();
    }, 30000);
    return () => {
      window.removeEventListener("focus", focus);
      clearInterval(timer);
    };
  }, [refresh]);
  const run = useCallback(
    async (operation: string, args: Payload = {}, display = false) => {
      const actionPath = livePath.current;
      if (!actionPath) return;
      setBusy(true);
      try {
        const withOptions = { ...args };
        if (
          operation === "branch.checkout" ||
          operation === "commit.checkout" ||
          (operation === "branch.create" && withOptions.checkout)
        ) {
          historyFocusRef.current = null;
          refreshEpoch.current++;
        }
        if (
          autoStashOperations.has(operation) &&
          withOptions.autoStash === undefined
        )
          withOptions.autoStash = boot?.settings.autoStash ?? true;
        const result = await invoke<{
          output: string;
          command: string;
          autoStash?: AutoStashInfo;
        }>("repo.action", { ...withOptions, path: actionPath, operation });
        if (livePath.current === actionPath) await refresh();
        if (diff && !diff.commit && livePath.current === actionPath) {
          try {
            const refreshedDiff = await invoke<string>("repo.diff", {
              path: actionPath,
              file: diff.file,
              staged: diff.staged,
            });
            if (livePath.current === actionPath)
              setDiff({ ...diff, text: refreshedDiff });
          } catch {
            setDiff(null);
          }
        }
        setActivity(await invoke<Activity[]>("app.activity"));
        notify(
          operation === "commit"
            ? "Commit creato"
            : `${actions.find((x) => x.id === operation)?.title || ({ stage: "File aggiunti allo staging", unstage: "File rimossi dallo staging", "hunk.stage": "Hunk aggiunto allo staging", "hunk.unstage": "Hunk rimosso dallo staging" } as Record<string, string>)[operation] || "Operazione completata"}`,
        );
        if (
          display ||
          result.output?.length > 600 ||
          result.autoStash?.conflict
        )
          setOutput({
            title: "Operazione completata",
            text: result.output || "Completata senza output.",
            command: result.command,
          });
        return true;
      } catch (e) {
        if (livePath.current === actionPath) await refresh();
        setActivity(await invoke<Activity[]>("app.activity").catch(() => []));
        notify(String(e), true);
        setOutput({ title: "Operazione non completata", text: String(e) });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [invoke, refresh, notify, diff, boot?.settings],
  );
  const showAction = useCallback(
    (id: string, values: Payload = {}) => {
      const action = actions.find((x) => x.id === id);
      if (!action) return;
      const defaults: Payload = {};
      action.fields?.forEach((f) => {
        defaults[f.name] =
          f.default ??
          (f.type === "checkbox"
            ? false
            : f.type === "select"
              ? f.options?.[0]
              : "");
      });
      if (autoStashOperations.has(id))
        defaults.autoStash = boot?.settings.autoStash ?? true;
      if (Array.isArray(values.files))
        defaults.filesText = (values.files as string[]).join("\n");
      if (action.fields?.some((f) => f.name === "hash") && selected)
        defaults.hash = selected;
      if (
        id === "branch.rename" ||
        id === "branch.delete" ||
        id === "branch.checkout"
      )
        defaults.name = snapshot?.branch || "";
      if (id === "push") defaults.branch = snapshot?.branch || "";
      if (id.startsWith("operation."))
        defaults.kind = snapshot?.operation || "merge";
      setMenu(null);
      setModal({
        action,
        values: { ...defaults, ...values },
        repoPath: livePath.current,
      });
    },
    [snapshot, selected, boot?.settings],
  );
  const checkoutBranch = (name: string) => {
    if (busy || !snapshot || snapshot.branch === name) return;
    const enabled = boot?.settings.autoStash ?? true;
    if (snapshot.files.length && !enabled)
      showAction("branch.checkout", { name, autoStash: false });
    else void run("branch.checkout", { name, autoStash: enabled });
  };
  const submitCommit = useCallback(async () => {
    if (
      !subject.trim() ||
      busy ||
      !snapshot ||
      (!snapshot.files.some((f) => f.staged) && !(amend && snapshot.head))
    )
      return;
    const commitPath = livePath.current;
    const success = await run("commit", {
      message: subject.trim(),
      description,
      amend,
      sign,
    });
    if (success && livePath.current === commitPath) {
      setSubject("");
      setDescription("");
      setAmend(false);
    }
  }, [subject, description, amend, sign, snapshot, busy, run]);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
        setPaletteSearch("");
      }
      if (cmd && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void openRepo();
      }
      if (
        cmd &&
        e.key === "Enter" &&
        !modal &&
        !palette &&
        !output &&
        !aiSettingsOpen &&
        !hostingSettingsOpen &&
        !toolsOpen
      ) {
        e.preventDefault();
        void submitCommit();
      }
      if (
        cmd &&
        e.key.toLowerCase() === "f" &&
        view === "graph" &&
        !modal &&
        !aiSettingsOpen &&
        !hostingSettingsOpen &&
        !palette
      ) {
        e.preventDefault();
        graphSearchRef.current?.focus();
      }
      if (e.altKey && e.key.toLowerCase() === "g") {
        e.preventDefault();
        setView("graph");
        setDiff(null);
      }
      if (cmd && e.key.toLowerCase() === "r") {
        e.preventDefault();
        void refresh();
      }
      if (e.key === "Escape") {
        if (hostingSettingsOpen) return;
        setAISettingsOpen(false);
        setMenu(null);
        setModal(null);
        setPalette(false);
        setOutput(null);
        if (!modal && !palette) setDiff(null);
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [
    openRepo,
    submitCommit,
    refresh,
    modal,
    palette,
    output,
    toolsOpen,
    aiSettingsOpen,
    hostingSettingsOpen,
    view,
  ]);
  useEffect(() => {
    let active = true;
    if (view === "activity")
      invoke<Activity[]>("app.activity")
        .then((a) => {
          if (active) setActivity(a);
        })
        .catch((e) => notify(String(e), true));
    return () => {
      active = false;
    };
  }, [view, path, invoke, notify]);
  const selectCommit = async (hash: string) => {
    const currentPath = livePath.current,
      token = ++selectionEpoch.current;
    if (!currentPath) return;
    setSelected(hash);
    liveSelection.current = hash;
    scrollTargetRef.current = hash;
    setDiff(null);
    diffEpoch.current++;
    setDetails(null);
    setRightOpen(true);
    setView("graph");
    setSearch("");
    const needsFocus = !snapshot?.commits.some(
      (commit) => commit.hash === hash,
    );
    historyFocusRef.current = needsFocus ? hash : renderedFocusRef.current;
    const historyToken = ++refreshEpoch.current;
    if (needsFocus) {
      void invoke<Snapshot>("repo.snapshot", {
        path: currentPath,
        focusRef: hash,
      })
        .then((next) => {
          if (
            currentPath === livePath.current &&
            token === selectionEpoch.current &&
            historyToken === refreshEpoch.current
          ) {
            renderedFocusRef.current = hash;
            setSnapshot(next);
          }
        })
        .catch((e) => {
          if (
            currentPath === livePath.current &&
            token === selectionEpoch.current
          )
            notify(String(e), true);
        });
    }
    try {
      const result = await invoke<CommitDetails>("repo.commitDetails", {
        path: currentPath,
        hash,
      });
      if (currentPath === livePath.current && token === selectionEpoch.current)
        setDetails(result);
    } catch (e) {
      if (currentPath === livePath.current && token === selectionEpoch.current)
        notify(String(e), true);
    }
  };
  const showAllHistory = async () => {
    const currentPath = livePath.current;
    if (!currentPath) return;
    historyFocusRef.current = null;
    const token = ++refreshEpoch.current;
    try {
      const next = await invoke<Snapshot>("repo.snapshot", {
        path: currentPath,
      });
      if (currentPath === livePath.current && token === refreshEpoch.current) {
        renderedFocusRef.current = null;
        setSnapshot(next);
        setSearch("");
      }
    } catch (e) {
      if (currentPath === livePath.current && token === refreshEpoch.current)
        notify(String(e), true);
    }
  };
  const showDiff = async (file: string, staged = false, commit?: string) => {
    const currentPath = livePath.current,
      token = ++diffEpoch.current;
    try {
      const text = await invoke<string>("repo.diff", {
        path: currentPath,
        file,
        staged,
        commit,
      });
      if (currentPath === livePath.current && token === diffEpoch.current) {
        setDiff({ text, title: file, file, staged, commit });
        setView("graph");
      }
    } catch (e) {
      if (currentPath === livePath.current && token === diffEpoch.current)
        notify(String(e), true);
    }
  };
  const inspectFile = async (mode: "file" | "blame" | "history") => {
    if (!diff) return;
    try {
      const result = await invoke<any>(`repo.${mode}`, {
        path,
        file: diff.file,
        ref: diff.commit,
      });
      setOutput({
        title:
          mode === "blame"
            ? `Blame · ${diff.file}`
            : mode === "history"
              ? `Cronologia · ${diff.file}`
              : diff.file,
        text:
          mode === "history"
            ? (result as Commit[])
                .map(
                  (c) =>
                    `${c.shortHash}  ${relative(c.date)}  ${c.author}\n${c.subject}\n`,
                )
                .join("\n")
            : String(result),
      });
    } catch (e) {
      notify(String(e), true);
    }
  };
  const context = (
    e: React.MouseEvent,
    items: NonNullable<typeof menu>["items"],
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - 252),
      y: Math.min(e.clientY, window.innerHeight - items.length * 34 - 20),
      items,
    });
  };
  const changeTheme = async () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      const settings = await invoke<Settings>("app.settings", {
        settings: { theme: next },
      });
      setBoot((b) => (b ? { ...b, settings } : b));
    } catch (e) {
      notify(String(e), true);
    }
  };
  const filteredCommits = useMemo(
    () =>
      snapshot?.commits.filter((c) =>
        `${c.subject} ${c.author} ${c.hash} ${c.refs.join(" ")}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ) || [],
    [snapshot, search],
  );
  const graphWidth = useMemo(
    () => buildGraph(filteredCommits).width,
    [filteredCommits],
  );
  useLayoutEffect(() => {
    const container = graphContentRef.current;
    if (!container || view !== "graph" || diff) return;
    const measure = () => {
      const origin = container.getBoundingClientRect().top;
      const rows = Array.from(
        container.querySelectorAll<HTMLElement>(".commit-row"),
      ).map((row) => {
        const rect = row.getBoundingClientRect();
        return { top: rect.top - origin, height: rect.height };
      });
      setGraphRows((previous) =>
        previous.length === rows.length &&
        previous.every(
          (row, i) =>
            Math.abs(row.top - rows[i].top) < 0.1 &&
            Math.abs(row.height - rows[i].height) < 0.1,
        )
          ? previous
          : rows,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    container
      .querySelectorAll(".commit-row")
      .forEach((row) => observer.observe(row));
    return () => observer.disconnect();
  }, [filteredCommits, view, diff, refsWidth, boot?.settings.fontSize]);
  useLayoutEffect(() => {
    if (
      !selected ||
      scrollTargetRef.current !== selected ||
      view !== "graph" ||
      diff
    )
      return;
    const row = Array.from(
      graphContentRef.current?.querySelectorAll<HTMLElement>(".commit-row") ||
        [],
    ).find((element) => element.dataset.commitHash === selected);
    if (row) {
      row.scrollIntoView({ block: "nearest", inline: "nearest" });
      scrollTargetRef.current = null;
    }
  }, [selected, filteredCommits, view, diff]);
  const resizeReferences = (event: React.PointerEvent) => {
    event.preventDefault();
    (event.currentTarget as HTMLElement).focus();
    resizeCleanupRef.current?.();
    const initialX = event.clientX,
      initialWidth = refsWidth;
    const move = (e: PointerEvent) =>
      setRefsWidth(
        Math.max(128, Math.min(520, initialWidth + e.clientX - initialX)),
      );
    const finish = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", finish);
      resizeCleanupRef.current = null;
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", finish, { once: true });
    document.addEventListener("pointercancel", finish, { once: true });
    resizeCleanupRef.current = finish;
  };
  useEffect(() => () => resizeCleanupRef.current?.(), []);
  const pendingAutoStash = (
    snapshot as (Snapshot & { autoStash?: AutoStashInfo }) | null
  )?.autoStash;
  const awaitingAutoStash = Boolean(
    pendingAutoStash?.awaitingOperation &&
    pendingAutoStash.awaitingOperation === snapshot?.operation,
  );
  const history = snapshot as HistorySnapshot | null;
  const staged = snapshot?.files.filter((f) => f.staged) || [],
    unstaged = snapshot?.files.filter((f) => f.unstaged) || [],
    conflicts = snapshot?.files.filter((f) => f.conflict) || [];
  const groupToggle = (id: string) =>
    setCollapsed((c) => ({ ...c, [id]: !c[id] }));
  const sidebarGroup = (
    id: string,
    label: string,
    count: number,
    icon: React.ReactNode,
    children: React.ReactNode,
    add?: string,
  ) => (
    <section className="ref-group">
      <div className="ref-group-heading">
        <button onClick={() => groupToggle(id)}>
          {collapsed[id] ? (
            <ChevronRight size={12} />
          ) : (
            <ChevronDown size={12} />
          )}
          <span>{label}</span>
          <span className="subtle-count">{count}</span>
        </button>
        {add && (
          <button
            className="icon-button"
            title={`Aggiungi ${label.toLowerCase()}`}
            onClick={() => showAction(add)}
          >
            <Plus size={13} />
          </button>
        )}
      </div>
      {!collapsed[id] && (
        <div className="ref-items">
          {count === 0 ? (
            <div className="ref-empty">Nessun {label.toLowerCase()}</div>
          ) : (
            children
          )}
        </div>
      )}
    </section>
  );
  const fileRow = (file: FileChange, isStaged: boolean) => (
    <div
      className={`file-row ${file.conflict ? "conflicted" : ""} ${diff?.file === file.path && diff.staged === isStaged ? "selected" : ""}`}
      key={`${isStaged}-${file.path}`}
      onClick={() =>
        file.conflict
          ? setConflictFile(file.path)
          : void showDiff(file.path, isStaged)
      }
      onContextMenu={(e) =>
        context(e, [
          {
            label: isStaged ? "Rimuovi dallo staging" : "Aggiungi allo staging",
            fn: () =>
              void run(isStaged ? "unstage" : "stage", { files: [file.path] }),
          },
          { label: "Apri diff", fn: () => void showDiff(file.path, isStaged) },
          {
            label: "Ignora file (.gitignore)",
            operation: "ignore",
            values: { files: [file.path] },
          },
          {
            label: "Smetti di tracciare il file",
            operation: "untrack",
            values: { files: [file.path] },
          },
          {
            label: "Traccia con Git LFS",
            operation: "lfs.track",
            values: { file: file.path },
          },
          {
            label: "Scarta modifiche",
            operation: "discard",
            values: { files: [file.path] },
            danger: true,
          },
          ...(file.conflict
            ? [
                {
                  label: "Risolvi conflitto",
                  operation: "conflict.resolve",
                  values: { file: file.path },
                },
              ]
            : []),
        ])
      }
    >
      <FileCode2 size={15} />
      <span className="file-path" title={file.path}>
        {file.path.includes("/") ? (
          <>
            <span className="file-folder">
              {file.path.slice(0, file.path.lastIndexOf("/") + 1)}
            </span>
            {file.path.slice(file.path.lastIndexOf("/") + 1)}
          </>
        ) : (
          file.path
        )}
      </span>
      <span
        className={`file-status status-${file.conflict ? "U" : isStaged ? file.index : file.worktree}`}
      >
        {file.conflict
          ? "!"
          : isStaged
            ? file.index === " "
              ? "M"
              : file.index
            : file.worktree === "?"
              ? "U"
              : file.worktree}
      </span>
      <button
        className="file-stage"
        title={isStaged ? "Rimuovi dallo staging" : "Aggiungi allo staging"}
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          void run(isStaged ? "unstage" : "stage", { files: [file.path] });
        }}
      >
        {isStaged ? <Minus size={13} /> : <Plus size={13} />}
      </button>
    </div>
  );
  const currentCommit = details?.commit;
  const optionItems = actions.filter(
    (x) => !["discard", "conflict.resolve"].includes(x.id),
  );
  const submitModal = async () => {
    if (!modal) return;
    if (modal.action && modal.repoPath !== livePath.current) {
      setModal(null);
      notify(
        "Il repository è cambiato. Riapri l’operazione per il repository attuale.",
        true,
      );
      return;
    }
    const values = { ...modal.values };
    try {
      if (modal.action) {
        if (["ignore", "untrack"].includes(modal.action.id)) {
          values.files = String(values.filesText || "")
            .split("\n")
            .map((f) => f.trim())
            .filter(Boolean);
          delete values.filesText;
        }
        if (values.strategy === "manuale") delete values.strategy;
        else if (modal.action.id === "conflict.resolve") delete values.content;
        if (
          modal.action.id === "push" &&
          values.force &&
          !values.confirmForce
        ) {
          setModal({ ...modal, values: { ...values, confirmForce: true } });
          return;
        }
        const success = await run(modal.action.id, values, true);
        if (success) setModal(null);
      } else if (modal.type === "settings") {
        const settings = await invoke<Settings>("app.settings", {
          settings: settingsDraft,
        });
        setTheme(settings.theme);
        setBoot((b) => (b ? { ...b, settings } : b));
        setModal(null);
        notify("Preferenze salvate");
      } else {
        setBusy(true);
        openSnapshot(
          await invoke<Snapshot>(
            modal.type === "clone" ? "repo.clone" : "repo.init",
            values,
          ),
        );
        setModal(null);
        notify(
          modal.type === "clone" ? "Repository clonato" : "Repository creato",
        );
      }
    } catch (e) {
      notify(String(e), true);
    } finally {
      setBusy(false);
    }
  };
  const refLabel = (ref: string, hash: string) => {
    const label = ref.replace("HEAD -> ", "").replace("tag: ", "");
    const isTag = ref.startsWith("tag:");
    const branch = isTag
      ? undefined
      : snapshot?.branches.find((b) => b.name === label);
    return (
      <button
        type="button"
        className={`ref-label ${isTag ? "tag-ref" : branch?.remote ? "remote-ref" : "local-ref"}`}
        key={ref}
        title={`${ref}${branch && !branch.remote ? " · Doppio clic per checkout" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          void selectCommit(hash);
        }}
        onDoubleClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (branch && !branch.remote) checkoutBranch(branch.name);
          else if (branch?.remote)
            showAction("branch.create", {
              name: branch.name.replace(/^[^/]+\//, ""),
              start: branch.name,
            });
          else void selectCommit(hash);
        }}
        onContextMenu={(e) =>
          context(
            e,
            isTag
              ? [
                  {
                    label: "Visualizza commit",
                    fn: () => void selectCommit(hash),
                  },
                  {
                    label: "Elimina tag",
                    operation: "tag.delete",
                    values: { name: label },
                    danger: true,
                  },
                ]
              : branch
                ? [
                    {
                      label: "Checkout branch",
                      operation: branch.remote
                        ? "branch.create"
                        : "branch.checkout",
                      values: branch.remote
                        ? {
                            name: branch.name.replace(/^[^/]+\//, ""),
                            start: branch.name,
                          }
                        : { name: branch.name },
                    },
                    {
                      label: "Merge nel branch attuale",
                      operation: "merge",
                      values: { ref: branch.name },
                    },
                    {
                      label: "Crea branch qui",
                      operation: "branch.create",
                      values: { start: hash },
                    },
                  ]
                : [
                    {
                      label: "Visualizza commit",
                      fn: () => void selectCommit(hash),
                    },
                  ],
          )
        }
      >
        {isTag ? <Tag size={11} /> : <GitBranch size={11} />}
        <span>{label}</span>
      </button>
    );
  };

  return (
    <div
      className={`app ${rightOpen ? "" : "inspector-hidden"}`}
      style={
        {
          fontSize: `${boot?.settings.fontSize || 13}px`,
          "--font-scale": (boot?.settings.fontSize || 13) / 13,
        } as React.CSSProperties
      }
      onClick={() => menu && setMenu(null)}
    >
      <header className="titlebar">
        <div className="traffic-space" />
        <div className="brand">
          <div className="brand-mark">
            <GitFork size={19} />
          </div>
          <strong>Branchline</strong>
          <span className="edition">LOCAL</span>
        </div>
        <div className="repo-tabs">
          {boot?.repos.slice(0, 5).map((r) => (
            <div
              className={`repo-tab ${path === r.path ? "active" : ""}`}
              key={r.path}
            >
              <button onClick={() => void openRepo(r.path)} title={r.path}>
                <FolderGit2 size={14} />
                {r.name}
              </button>
              <button
                className="tab-close"
                title="Chiudi repository"
                onClick={async () => {
                  await invoke("repo.close", { path: r.path });
                  setBoot((b) =>
                    b
                      ? {
                          ...b,
                          repos: b.repos.filter((x) => x.path !== r.path),
                        }
                      : b,
                  );
                  if (path === r.path) {
                    setSnapshot(null);
                    setDiff(null);
                  }
                }}
              >
                <X size={12} />
              </button>
            </div>
          ))}
          <button
            className="tab-add"
            title="Apri, crea o esplora un repository"
            onClick={(e) =>
              context(e, [
                { label: "Apri repository", fn: () => void openRepo() },
                {
                  label: "Clona repository",
                  fn: () =>
                    setModal({
                      type: "clone",
                      values: { url: "", destination: "" },
                    }),
                },
                {
                  label: "Crea repository",
                  fn: () => setModal({ type: "init", values: { path: "" } }),
                },
                { label: "Esplora demo isolata", fn: () => void openDemo() },
              ])
            }
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="window-tools">
          <button
            className="icon-button"
            title="Palette comandi (⌘K)"
            onClick={() => {
              setPalette(true);
              setPaletteSearch("");
            }}
          >
            <Command size={15} />
          </button>
          <button
            className="icon-button"
            title={theme === "dark" ? "Tema chiaro" : "Tema scuro"}
            onClick={() => void changeTheme()}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button
            className="icon-button"
            title="Preferenze"
            onClick={() => {
              setSettingsDraft(boot?.settings || {});
              setModal({ type: "settings", values: {} });
            }}
          >
            <SettingsIcon size={16} />
          </button>
        </div>
      </header>
      <div className="toolbar">
        <div className="undo-actions">
          <button
            title="Annulla ultima operazione locale protetta"
            disabled={!snapshot || busy}
            onClick={() => void run("undo")}
          >
            <Undo2 size={17} />
            <span>Annulla</span>
          </button>
          <button
            title="Ripeti operazione annullata"
            disabled={!snapshot || busy}
            onClick={() => void run("redo")}
          >
            <Redo2 size={17} />
            <span>Ripeti</span>
          </button>
        </div>
        <div className="toolbar-separator" />
        <div className="sync-actions">
          <button
            disabled={!snapshot || busy}
            onClick={() => void run("fetch", { prune: true })}
          >
            <RefreshCw size={17} className={busy ? "spin" : ""} />
            <span>Fetch</span>
          </button>
          <button
            disabled={!snapshot || busy}
            onClick={() => showAction("pull")}
          >
            <ArrowDownToLine size={17} />
            <span>Pull</span>
            {snapshot && snapshot.behind > 0 && (
              <small>{snapshot.behind}</small>
            )}
          </button>
          <button
            disabled={!snapshot || busy}
            onClick={() => showAction("push")}
          >
            <ArrowUpFromLine size={17} />
            <span>Push</span>
            {snapshot && snapshot.ahead > 0 && <small>{snapshot.ahead}</small>}
          </button>
        </div>
        <div className="toolbar-separator" />
        <button
          disabled={!snapshot || busy}
          onClick={() => showAction("branch.create")}
        >
          <GitBranch size={17} />
          <span>Branch</span>
        </button>
        <button
          disabled={!snapshot || busy}
          onClick={() => showAction("stash.create")}
        >
          <Layers size={17} />
          <span>Stash</span>
        </button>
        <button
          disabled={!snapshot}
          onClick={() => setTerminal((t) => !t)}
          className={terminal ? "on" : ""}
        >
          <Terminal size={17} />
          <span>Terminale</span>
        </button>
        <button disabled={!snapshot} onClick={() => setToolsOpen(true)}>
          <Code2 size={17} />
          <span>Strumenti</span>
        </button>
        <div className="toolbar-spacer" />
        <button
          className="command-button"
          onClick={() => {
            setPalette(true);
            setPaletteSearch("");
          }}
        >
          <Search size={15} />
          <span>Cerca un comando…</span>
          <kbd>⌘ K</kbd>
        </button>
        <button
          title="Tutte le operazioni Git"
          disabled={!snapshot}
          onClick={(e) =>
            context(
              e,
              optionItems.map((a) => ({
                label: a.title,
                operation: a.id,
                danger: a.danger,
              })),
            )
          }
        >
          <MoreHorizontal size={20} />
        </button>
        <button
          title={rightOpen ? "Nascondi pannello" : "Mostra pannello"}
          onClick={() => setRightOpen((r) => !r)}
        >
          {rightOpen ? (
            <PanelRightClose size={17} />
          ) : (
            <PanelRightOpen size={17} />
          )}
        </button>
      </div>
      {!snapshot ? (
        <main className="welcome">
          <div className="welcome-main">
            <div className="welcome-logo">
              <GitFork size={40} />
            </div>
            <div className="eyebrow">IL TUO WORKSPACE GIT</div>
            <h1>
              Ogni branch.
              <br />
              <span>Una visione chiara.</span>
            </h1>
            <p>
              La cronologia, le modifiche e il prossimo commit.
              <br />
              Tutto nel tuo desktop, con Git sul tuo computer.
            </p>
            <div className="welcome-buttons">
              <button
                className="primary"
                onClick={() => void openRepo()}
                disabled={busy || loading}
              >
                <FolderOpen size={17} />
                Apri repository<kbd>⌘ O</kbd>
              </button>
              <button
                className="secondary"
                onClick={() =>
                  setModal({
                    type: "clone",
                    values: { url: "", destination: "" },
                  })
                }
              >
                <Download size={17} />
                Clona repository
              </button>
            </div>
            <div className="welcome-links">
              <button
                onClick={() => setModal({ type: "init", values: { path: "" } })}
              >
                <Plus size={14} />
                Crea repository
              </button>
              <button disabled={busy} onClick={() => void openDemo()}>
                <Play size={14} />
                Esplora la demo
              </button>
            </div>
          </div>
          <div className="welcome-side">
            <div className="welcome-illustration">
              <svg width="310" height="240" viewBox="0 0 310 240">
                <defs>
                  <linearGradient id="glow" x1="0" y1="0" x2="1" y2="1">
                    <stop stopColor="#56d9bd" />
                    <stop offset="1" stopColor="#9b8af8" />
                  </linearGradient>
                </defs>
                <path
                  d="M 102 218 L 102 29 M 102 180 C 102 148 193 154 193 120 L 193 64 M 102 124 C 102 85 247 108 247 74 L 247 28"
                  stroke="#8f7ee5"
                  strokeWidth="2"
                  fill="none"
                  opacity=".8"
                />
                <path
                  d="M 193 94 C 193 62 102 95 102 53"
                  stroke="#67acfa"
                  strokeWidth="2"
                  fill="none"
                />
                {[29, 74, 124, 180, 218].map((y, i) => (
                  <g key={y}>
                    <circle
                      cx="102"
                      cy={y}
                      r="7"
                      fill="var(--surface)"
                      stroke="#58d6bc"
                      strokeWidth="2.6"
                    />
                    {i < 3 && (
                      <rect
                        x="119"
                        y={y - 4}
                        width={i === 0 ? 42 : 64}
                        height="7"
                        rx="3.5"
                        fill="#58d6bc"
                        opacity=".14"
                      />
                    )}
                  </g>
                ))}
                <circle
                  cx="193"
                  cy="64"
                  r="7"
                  fill="var(--surface)"
                  stroke="#68a9ff"
                  strokeWidth="2.6"
                />
                <circle
                  cx="193"
                  cy="120"
                  r="7"
                  fill="var(--surface)"
                  stroke="#68a9ff"
                  strokeWidth="2.6"
                />
                <circle
                  cx="247"
                  cy="28"
                  r="7"
                  fill="var(--surface)"
                  stroke="#9c88ff"
                  strokeWidth="2.6"
                />
                <circle
                  cx="247"
                  cy="74"
                  r="7"
                  fill="var(--surface)"
                  stroke="#9c88ff"
                  strokeWidth="2.6"
                />
              </svg>
              <span className="illustration-label">
                <span className="status-dot" />
                Il prossimo commit comincia qui
              </span>
            </div>
            {!!boot?.repos.length && (
              <div className="recent-repos">
                <div className="section-label">REPOSITORY RECENTI</div>
                {boot.repos.slice(0, 4).map((r) => (
                  <button key={r.path} onClick={() => void openRepo(r.path)}>
                    <FolderGit2 size={17} />
                    <div>
                      <strong>{r.name}</strong>
                      <span>{r.path.replace(/^\/Users\/[^/]+/, "~")}</span>
                    </div>
                    <ArrowUpRight size={16} />
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="welcome-foot">
            <span>
              <ShieldCheck size={15} />
              Git locale · Le credenziali restano sul tuo computer
            </span>
            <span>Branchline {boot?.version || "0.1.0"}</span>
          </div>
        </main>
      ) : (
        <>
          <div className="workspace">
            <aside
              className={`sidebar ${sidebarWide ? "sidebar-wide" : ""}`}
              style={{ width: sidebarWide ? 320 : 236 }}
            >
              <div
                className="repo-selector"
                onClick={() => void openRepo()}
                title={snapshot.path}
              >
                <div className="repo-icon">
                  <FolderGit2 size={19} />
                </div>
                <div>
                  <strong title={snapshot.name}>{snapshot.name}</strong>
                  <span>Repository locale</span>
                </div>
                <ChevronDown size={14} />
              </div>
              <nav className="main-nav">
                {(
                  [
                    { id: "graph", label: "Grafo", icon: GitFork },
                    { id: "changes", label: "Modifiche", icon: FileDiff },
                    { id: "activity", label: "Attività", icon: History },
                    {
                      id: "integrations",
                      label: "Integrazioni",
                      icon: GitPullRequest,
                    },
                  ] as const
                ).map((n) => (
                  <button
                    key={n.id}
                    className={view === n.id && !diff ? "active" : ""}
                    onClick={() => {
                      setView(n.id);
                      setDiff(null);
                    }}
                  >
                    <n.icon size={17} />
                    <span>{n.label}</span>
                    {n.id === "changes" && snapshot.files.length > 0 && (
                      <span className="nav-badge">{snapshot.files.length}</span>
                    )}
                    {n.id === "graph" && <span className="nav-hint">⌥ G</span>}
                  </button>
                ))}
              </nav>
              <div className="sidebar-divider" />
              <div className="refs-search">
                <Search size={13} />
                <input
                  placeholder="Filtra riferimenti…"
                  value={repoFilter}
                  onChange={(e) => setRepoFilter(e.target.value)}
                />
              </div>
              <div className="navigator-width-control">
                <button
                  title={
                    sidebarWide
                      ? "Compatta navigator"
                      : "Espandi navigator per leggere i nomi completi"
                  }
                  onClick={() => setSidebarWide((v) => !v)}
                >
                  <Maximize2 size={12} />
                  {sidebarWide ? "Compatta navigator" : "Espandi navigator"}
                </button>
              </div>
              <div className="sidebar-scroll">
                {sidebarGroup(
                  "local",
                  "BRANCH LOCALI",
                  snapshot.branches.filter((b) => !b.remote).length,
                  <GitBranch size={14} />,
                  snapshot.branches
                    .filter(
                      (b) =>
                        !b.remote &&
                        b.name.toLowerCase().includes(repoFilter.toLowerCase()),
                    )
                    .map((b) => (
                      <button
                        className={`ref-item ${b.current ? "current" : ""}`}
                        key={b.name}
                        title={`${b.name}${b.upstream ? " → " + b.upstream : ""}`}
                        onClick={() => void selectCommit(b.hash)}
                        onDoubleClick={() => checkoutBranch(b.name)}
                        onContextMenu={(e) =>
                          context(e, [
                            {
                              label: "Checkout branch",
                              operation: "branch.checkout",
                              values: { name: b.name },
                            },
                            {
                              label: "Merge nel branch attuale",
                              operation: "merge",
                              values: { ref: b.name },
                            },
                            {
                              label: "Rebase su questo branch",
                              operation: "rebase",
                              values: { ref: b.name },
                              danger: true,
                            },
                            {
                              label: "Rinomina",
                              operation: "branch.rename",
                              values: { name: b.name },
                            },
                            {
                              label: "Elimina",
                              operation: "branch.delete",
                              values: { name: b.name },
                              danger: true,
                            },
                          ])
                        }
                      >
                        <GitBranch size={14} />
                        <span>{b.name}</span>
                        {b.current && <span className="current-indicator" />}
                        {b.ahead > 0 && <small>↑{b.ahead}</small>}
                      </button>
                    )),
                  "branch.create",
                )}
                {boot?.settings.showRemoteBranches !== false &&
                  sidebarGroup(
                    "remote",
                    "REMOTE",
                    snapshot.branches.filter((b) => b.remote).length,
                    <Cloud size={14} />,
                    snapshot.branches
                      .filter(
                        (b) =>
                          b.remote &&
                          b.name
                            .toLowerCase()
                            .includes(repoFilter.toLowerCase()),
                      )
                      .map((b) => (
                        <button
                          className="ref-item remote-item"
                          key={b.name}
                          title={b.name}
                          onClick={() => void selectCommit(b.hash)}
                          onDoubleClick={() =>
                            showAction("branch.create", {
                              name: b.name.replace(/^[^/]+\//, ""),
                              start: b.name,
                            })
                          }
                          onContextMenu={(e) =>
                            context(e, [
                              {
                                label: "Crea branch locale",
                                operation: "branch.create",
                                values: {
                                  name: b.name.replace(/^[^/]+\//, ""),
                                  start: b.name,
                                },
                              },
                              {
                                label: "Merge nel branch attuale",
                                operation: "merge",
                                values: { ref: b.name },
                              },
                              {
                                label: "Rebase su questo branch",
                                operation: "rebase",
                                values: { ref: b.name },
                                danger: true,
                              },
                            ])
                          }
                        >
                          <Cloud size={14} />
                          <span>{b.name}</span>
                        </button>
                      )),
                    "remote.add",
                  )}
                {sidebarGroup(
                  "tags",
                  "TAG",
                  snapshot.tags.length,
                  <Tag size={14} />,
                  snapshot.tags
                    .filter((t) =>
                      t.name.toLowerCase().includes(repoFilter.toLowerCase()),
                    )
                    .map((t) => (
                      <button
                        className="ref-item"
                        key={t.name}
                        onClick={() => void selectCommit(t.hash)}
                        onContextMenu={(e) =>
                          context(e, [
                            {
                              label: "Visualizza commit",
                              fn: () => void selectCommit(t.hash),
                            },
                            {
                              label: "Elimina tag",
                              operation: "tag.delete",
                              values: { name: t.name },
                              danger: true,
                            },
                          ])
                        }
                      >
                        <Tag size={14} />
                        <span>{t.name}</span>
                      </button>
                    )),
                  "tag.create",
                )}
                {sidebarGroup(
                  "stashes",
                  "STASH",
                  snapshot.stashes.length,
                  <Layers size={14} />,
                  snapshot.stashes.map((s) => (
                    <button
                      className="ref-item"
                      key={s.ref}
                      title={s.subject}
                      onClick={() => showAction("stash.apply", { ref: s.ref })}
                      onContextMenu={(e) =>
                        context(e, [
                          {
                            label: "Applica stash",
                            operation: "stash.apply",
                            values: { ref: s.ref },
                          },
                          {
                            label: "Ripristina ed elimina",
                            operation: "stash.pop",
                            values: { ref: s.ref },
                          },
                          {
                            label: "Elimina stash",
                            operation: "stash.drop",
                            values: { ref: s.ref },
                            danger: true,
                          },
                        ])
                      }
                    >
                      <Layers size={14} />
                      <span>{s.subject.replace(/^On [^:]+: /, "")}</span>
                    </button>
                  )),
                  "stash.create",
                )}
                {sidebarGroup(
                  "worktrees",
                  "WORKTREE",
                  snapshot.worktrees.length,
                  <FolderGit2 size={14} />,
                  snapshot.worktrees.map((w) => (
                    <button
                      className="ref-item"
                      key={w.path}
                      title={w.path}
                      onClick={() => void openRepo(w.path)}
                      onContextMenu={(e) =>
                        context(e, [
                          {
                            label: "Apri worktree",
                            fn: () => void openRepo(w.path),
                          },
                          {
                            label: w.locked
                              ? "Sblocca worktree"
                              : "Blocca worktree",
                            operation: w.locked
                              ? "worktree.unlock"
                              : "worktree.lock",
                            values: { destination: w.path },
                          },
                          {
                            label: "Rimuovi worktree",
                            operation: "worktree.remove",
                            values: { destination: w.path },
                            danger: true,
                          },
                        ])
                      }
                    >
                      <FolderGit2 size={14} />
                      <span>
                        {w.branch.replace("refs/heads/", "") ||
                          w.path.split("/").pop()}
                      </span>
                      {w.path === path && (
                        <span className="current-indicator" />
                      )}
                    </button>
                  )),
                  "worktree.add",
                )}
              </div>
              <div className="sidebar-bottom">
                <div className="avatar small">
                  {avatar(boot?.settings.identityName || "Utente locale")}
                </div>
                <div>
                  <strong>
                    {boot?.settings.identityName || "Workspace locale"}
                  </strong>
                  <span>
                    <span className="status-dot" />
                    Git {snapshot.gitVersion.replace(/^git version\s+/, "")}
                  </span>
                </div>
                <button
                  className="icon-button"
                  title="Identità repository"
                  onClick={() =>
                    showAction("identity", {
                      name: boot?.settings.identityName || "",
                      email: boot?.settings.identityEmail || "",
                    })
                  }
                >
                  <SettingsIcon size={15} />
                </button>
              </div>
            </aside>
            <main className="main-pane">
              <div className="repository-heading">
                <div className="branch-summary">
                  <span className="branch-icon">
                    <GitBranch size={18} />
                  </span>
                  <h2
                    title={
                      snapshot.branch || `Detached HEAD · ${snapshot.head}`
                    }
                  >
                    {snapshot.branch || "Detached HEAD"}
                  </h2>
                  <button
                    className="icon-button"
                    title="Cambia branch"
                    onClick={(e) =>
                      context(
                        e,
                        snapshot.branches
                          .filter((b) => !b.remote)
                          .map((b) => ({
                            label: b.name,
                            operation: "branch.checkout",
                            values: { name: b.name },
                          })),
                      )
                    }
                  >
                    <ChevronDown size={14} />
                  </button>
                  <span className="sync-status">
                    {snapshot.upstream ? (
                      <>
                        <span className="status-dot" />
                        {snapshot.ahead === 0 && snapshot.behind === 0
                          ? "Sincronizzato"
                          : `${snapshot.ahead} da inviare · ${snapshot.behind} da ricevere`}
                      </>
                    ) : (
                      <>
                        <span className="status-dot muted-dot" />
                        Solo locale
                      </>
                    )}
                  </span>
                </div>
                <button
                  className="text-button"
                  title="Apri nel Finder"
                  onClick={() => void invoke("app.reveal", { path })}
                >
                  <FolderOpen size={14} />
                  <span>{snapshot.name}</span>
                  <ArrowUpRight size={12} />
                </button>
              </div>
              {snapshot.operation && (
                <div className="operation-banner">
                  <AlertTriangle size={16} />
                  <strong>{snapshot.operation} in corso</strong>
                  <span>Risolvi i conflitti per continuare.</span>
                  <button
                    onClick={() =>
                      showAction("operation.continue", {
                        kind: snapshot.operation,
                      })
                    }
                  >
                    Continua
                  </button>
                  <button
                    onClick={() =>
                      showAction("operation.abort", {
                        kind: snapshot.operation,
                      })
                    }
                  >
                    Interrompi
                  </button>
                </div>
              )}
              {pendingAutoStash && (
                <div
                  className={`autostash-banner ${!awaitingAutoStash ? "recovery-manual" : ""}`}
                >
                  <Layers size={16} />
                  <div>
                    <strong>Modifiche locali conservate in autostash</strong>
                    <span>
                      {awaitingAutoStash
                        ? "Ripristino dopo Continua o Interrompi"
                        : pendingAutoStash.conflict
                          ? "Ripristino in conflitto: risolvi i file. Stash e riferimento di recupero restano disponibili; Applica stash consente il recupero manuale con staging."
                          : "Ripristino manuale richiesto: recupera le modifiche con Applica stash e ripristina anche lo staging."}
                      {pendingAutoStash.originalBranch
                        ? ` · branch originale ${pendingAutoStash.originalBranch}`
                        : ""}
                    </span>
                  </div>
                  <code title={pendingAutoStash.ref}>
                    {pendingAutoStash.hash.slice(0, 8)}
                  </code>
                  {!awaitingAutoStash && (
                    <button
                      className="autostash-recovery"
                      disabled={
                        busy ||
                        (pendingAutoStash.conflict && conflicts.length > 0)
                      }
                      title={
                        pendingAutoStash.conflict && conflicts.length > 0
                          ? "Risolvi i conflitti prima di applicare lo stash"
                          : `Apri Applica stash con ${pendingAutoStash.ref} e ripristino staging`
                      }
                      onClick={() => {
                        setCollapsed((previous) => ({
                          ...previous,
                          stashes: false,
                        }));
                        showAction("stash.apply", {
                          ref: pendingAutoStash.ref,
                          index: true,
                        });
                      }}
                    >
                      Recupero manuale
                    </button>
                  )}
                  <button
                    className="icon-button"
                    title="Copia riferimento di recupero"
                    onClick={() => {
                      void navigator.clipboard.writeText(pendingAutoStash.ref);
                      notify("Riferimento di recupero copiato");
                    }}
                  >
                    <Copy size={13} />
                  </button>
                </div>
              )}
              {diff ? (
                <div className="diff-pane">
                  <div className="pane-heading diff-heading">
                    <button
                      className="icon-button"
                      title="Torna al grafo"
                      onClick={() => setDiff(null)}
                    >
                      <ArrowLeft size={17} />
                    </button>
                    <FileCode2 size={16} />
                    <div className="diff-title">
                      <strong>{diff.title}</strong>
                      <span>
                        {diff.commit
                          ? `Commit ${diff.commit.slice(0, 8)}`
                          : diff.staged
                            ? "Staging"
                            : "Working tree"}
                      </span>
                    </div>
                    <div className="segmented-control">
                      <button
                        className={diffMode === "unified" ? "active" : ""}
                        onClick={() => setDiffMode("unified")}
                      >
                        Unificato
                      </button>
                      <button
                        className={diffMode === "split" ? "active" : ""}
                        onClick={() => setDiffMode("split")}
                      >
                        Affiancato
                      </button>
                    </div>
                    <button
                      className="icon-button"
                      title="Chiudi diff"
                      onClick={() => setDiff(null)}
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <div className="diff-tools">
                    <span>
                      <FileDiff size={13} />
                      Confronto delle modifiche
                    </span>
                    <div>
                      <button onClick={() => void inspectFile("file")}>
                        Contenuto
                      </button>
                      <button onClick={() => void inspectFile("blame")}>
                        Blame
                      </button>
                      <button onClick={() => void inspectFile("history")}>
                        Cronologia file
                      </button>
                      {!diff.commit && (
                        <button
                          disabled={busy}
                          className="accent-text"
                          onClick={() =>
                            void run(diff.staged ? "unstage" : "stage", {
                              files: [diff.file],
                            })
                          }
                        >
                          {diff.staged
                            ? "Rimuovi dallo staging"
                            : "Aggiungi allo staging"}
                        </button>
                      )}
                    </div>
                  </div>
                  <DiffViewer
                    text={diff.text}
                    mode={diffMode}
                    onHunk={
                      !diff.commit
                        ? (patch) =>
                            void run(
                              diff.staged ? "hunk.unstage" : "hunk.stage",
                              { patch },
                            )
                        : undefined
                    }
                    staged={diff.staged}
                    busy={busy}
                  />
                </div>
              ) : view === "graph" ? (
                <>
                  <div className="graph-heading">
                    <div>
                      <h3>Cronologia</h3>
                      <span>
                        {snapshot.commits.length} commit
                        {history?.historyLimited
                          ? " · altri commit disponibili"
                          : ""}
                        {history?.historyFocus
                          ? ` · focus ${history.historyFocus.slice(0, 8)}`
                          : ""}
                      </span>
                    </div>
                    {historyFocusRef.current && (
                      <button
                        className="history-overview"
                        onClick={() => void showAllHistory()}
                      >
                        Tutti i riferimenti
                      </button>
                    )}
                    <div className="graph-filter">
                      <Search size={14} />
                      <input
                        ref={graphSearchRef}
                        placeholder="Cerca commit, autore, SHA…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                      {search && (
                        <button
                          className="icon-button"
                          onClick={() => setSearch("")}
                        >
                          <X size={12} />
                        </button>
                      )}
                      <kbd>⌘ F</kbd>
                    </div>
                    <button
                      className="icon-button"
                      title="Aggiorna (⌘R)"
                      disabled={busy}
                      onClick={() => void refresh()}
                    >
                      <RefreshCw size={15} />
                    </button>
                  </div>
                  <button
                    className={`wip-row ${selected === null ? "selected" : ""}`}
                    onClick={() => {
                      setSelected(null);
                      setDetails(null);
                      setRightOpen(true);
                    }}
                  >
                    <span className="wip-line" />
                    <span className="wip-graph">
                      <span className="wip-node" />
                    </span>
                    <span className="wip-subject">
                      <strong>Working tree</strong>
                      <span>
                        {snapshot.files.length
                          ? `${snapshot.files.length} file modificati`
                          : "Nessuna modifica locale"}
                      </span>
                    </span>
                    <span className="wip-pill">
                      {snapshot.files.length ? "WIP" : "PULITO"}
                    </span>
                    <ChevronRight size={15} />
                  </button>
                  <div
                    className="graph-scroll"
                    style={
                      {
                        "--graph-width": `${graphWidth}px`,
                        "--refs-width": `${refsWidth}px`,
                      } as React.CSSProperties
                    }
                  >
                    <div
                      className="graph-table-header"
                      style={
                        {
                          "--graph-width": `${graphWidth}px`,
                          "--refs-width": `${refsWidth}px`,
                        } as React.CSSProperties
                      }
                    >
                      <span className="refs-column-title">
                        RIFERIMENTI
                        <div
                          className="refs-column-resize"
                          role="separator"
                          aria-label="Larghezza colonna riferimenti"
                          aria-orientation="vertical"
                          aria-valuemin={128}
                          aria-valuemax={520}
                          aria-valuenow={refsWidth}
                          tabIndex={0}
                          title="Trascina per ampliare i riferimenti · doppio clic per ripristinare"
                          onPointerDown={resizeReferences}
                          onDoubleClick={() => setRefsWidth(210)}
                          onKeyDown={(e) => {
                            if (
                              e.key === "ArrowLeft" ||
                              e.key === "ArrowRight"
                            ) {
                              e.preventDefault();
                              setRefsWidth((w) =>
                                Math.max(
                                  128,
                                  Math.min(
                                    520,
                                    w + (e.key === "ArrowRight" ? 16 : -16),
                                  ),
                                ),
                              );
                            }
                          }}
                        />
                      </span>
                      <span>GRAFO</span>
                      <span>MESSAGGIO</span>
                      <span>AUTORE</span>
                      <span>DATA</span>
                      <span>SHA</span>
                    </div>
                    {filteredCommits.length ? (
                      <div className="graph-content" ref={graphContentRef}>
                        <div className="graph-svg-column">
                          <Graph
                            commits={filteredCommits}
                            selected={selected}
                            rowMetrics={graphRows}
                            onSelect={(hash) => void selectCommit(hash)}
                            onCheckout={(hash) =>
                              showAction("commit.checkout", { hash })
                            }
                          />
                        </div>
                        {filteredCommits.map((c) => (
                          <div
                            className={`commit-row ${selected === c.hash ? "selected" : ""}`}
                            key={c.hash}
                            data-commit-hash={c.hash}
                            onClick={() => void selectCommit(c.hash)}
                            onDoubleClick={() =>
                              showAction("commit.checkout", { hash: c.hash })
                            }
                            onContextMenu={(e) =>
                              context(e, [
                                {
                                  label: "Dettagli commit",
                                  fn: () => void selectCommit(c.hash),
                                },
                                {
                                  label: "Apri questo commit (detached HEAD)",
                                  operation: "commit.checkout",
                                  values: { hash: c.hash },
                                },
                                {
                                  label: "Copia SHA",
                                  fn: () => {
                                    void navigator.clipboard.writeText(c.hash);
                                    notify("SHA copiato");
                                  },
                                },
                                {
                                  label: "Crea branch qui",
                                  operation: "branch.create",
                                  values: { start: c.hash },
                                },
                                {
                                  label: "Crea tag qui",
                                  operation: "tag.create",
                                  values: { ref: c.hash },
                                },
                                {
                                  label: "Cherry-pick",
                                  operation: "cherryPick",
                                  values: { hash: c.hash },
                                },
                                {
                                  label: "Revert",
                                  operation: "revert",
                                  values: { hash: c.hash },
                                },
                                {
                                  label: "Reset su questo commit",
                                  operation: "reset",
                                  values: { ref: c.hash },
                                  danger: true,
                                },
                              ])
                            }
                          >
                            <div className="commit-refs">
                              {c.refs.map((ref) => refLabel(ref, c.hash))}
                            </div>
                            <div className="graph-cell" />
                            <div className="commit-subject" title={c.subject}>
                              {c.parents.length > 1 && <GitMerge size={13} />}
                              <span>{displayCommitText(c.subject)}</span>
                            </div>
                            <div className="commit-author">
                              <span className="avatar tiny">
                                {avatar(c.author)}
                              </span>
                              <span title={c.email}>{c.author}</span>
                            </div>
                            <span
                              className="commit-date"
                              title={new Date(c.date).toLocaleString("it-IT")}
                            >
                              {relative(c.date)}
                            </span>
                            <code className="commit-hash">{c.shortHash}</code>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Empty
                        icon={<GitCommitHorizontal size={27} />}
                        title={
                          search
                            ? "Nessun commit trovato"
                            : "Il primo commit ti aspetta"
                        }
                        text={
                          search
                            ? "Prova un altro autore, messaggio o riferimento."
                            : "Aggiungi file, preparali nello staging e crea il tuo primo commit."
                        }
                      />
                    )}
                  </div>
                </>
              ) : view === "changes" ? (
                <div className="changes-view">
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">WORKING TREE</div>
                      <h2>Le tue modifiche</h2>
                      <p>
                        Prepara il prossimo commit, un file o un hunk alla
                        volta.
                      </p>
                    </div>
                    <span className="big-count">{snapshot.files.length}</span>
                  </div>
                  {snapshot.files.length ? (
                    <div className="changes-list">
                      {snapshot.files.map((f) => (
                        <button
                          key={f.path}
                          className="change-card"
                          onClick={() =>
                            f.conflict
                              ? setConflictFile(f.path)
                              : void showDiff(f.path, f.staged && !f.unstaged)
                          }
                        >
                          <span
                            className={`change-symbol status-${f.conflict ? "U" : f.worktree === " " ? f.index : f.worktree}`}
                          >
                            {f.conflict
                              ? "!"
                              : f.worktree === " "
                                ? "M"
                                : f.worktree === "?"
                                  ? "+"
                                  : f.worktree}
                          </span>
                          <div>
                            <strong>{f.path}</strong>
                            <span>
                              {f.conflict
                                ? "Conflitto da risolvere"
                                : f.staged && f.unstaged
                                  ? "Modifiche preparate e locali"
                                  : f.staged
                                    ? "Nello staging"
                                    : "Non preparato"}
                            </span>
                          </div>
                          <ArrowUpRight size={17} />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      icon={<CheckCircle2 size={30} />}
                      title="Tutto in ordine"
                      text="Il working tree è pulito. Sei pronto per il prossimo passo."
                    />
                  )}
                </div>
              ) : view === "activity" ? (
                <div className="activity-view">
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">IL TUO LAVORO, TRACCIABILE</div>
                      <h2>Registro attività</h2>
                      <p>
                        Operazioni realmente eseguite da Branchline sul tuo
                        computer.
                      </p>
                    </div>
                    <History size={28} />
                  </div>
                  {activity.length ? (
                    activity
                      .slice()
                      .reverse()
                      .map((a) => (
                        <button
                          className="activity-row"
                          key={a.id}
                          onClick={() =>
                            setOutput({
                              title: a.operation,
                              text: a.output || "Completata senza output.",
                              command: a.command,
                            })
                          }
                        >
                          <span
                            className={
                              a.success
                                ? "activity-success"
                                : "activity-failure"
                            }
                          >
                            {a.success ? <Check size={15} /> : <X size={15} />}
                          </span>
                          <div>
                            <strong>
                              {actions.find((x) => x.id === a.operation)
                                ?.title || a.operation}
                            </strong>
                            <code>{a.command}</code>
                          </div>
                          <time>
                            {new Date(a.time).toLocaleTimeString("it-IT", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </time>
                          <ChevronRight size={15} />
                        </button>
                      ))
                  ) : (
                    <Empty
                      icon={<History size={30} />}
                      title="Una nuova pagina"
                      text="Le operazioni eseguite compariranno qui, con comandi e risultati."
                    />
                  )}
                  <div className="reflog-heading">
                    <h3>Reflog del repository</h3>
                    <span>{snapshot.reflog.length} eventi Git</span>
                  </div>
                  {snapshot.reflog.slice(0, 30).map((r, i) => (
                    <div className="reflog-row" key={`${r.ref}-${i}`}>
                      <code>{r.hash.slice(0, 8)}</code>
                      <span>{r.subject}</span>
                      <small>{relative(r.date)}</small>
                    </div>
                  ))}
                </div>
              ) : (
                <HostingIntegration
                  key={snapshot.path}
                  snapshot={snapshot}
                  revision={hostingRevision}
                  onOpenSettings={() => setHostingSettingsOpen(true)}
                />
              )}
            </main>
            {rightOpen && (
              <aside className="inspector">
                {selected ? (
                  <>
                    <div className="inspector-heading">
                      <GitCommitHorizontal size={18} />
                      <h3>Dettagli commit</h3>
                      <button
                        className="icon-button"
                        title="Torna alle modifiche locali"
                        onClick={() => {
                          setSelected(null);
                          setDetails(null);
                        }}
                      >
                        <X size={15} />
                      </button>
                    </div>
                    {currentCommit ? (
                      <div className="commit-details">
                        <div className="commit-detail-label">COMMIT</div>
                        <h3 title={currentCommit.subject}>
                          {displayCommitText(currentCommit.subject)}
                        </h3>
                        {currentCommit.body && (
                          <>
                            <div className="commit-message-toolbar">
                              <span>MESSAGGIO</span>
                              <button
                                className={rawCommitMessage ? "active" : ""}
                                onClick={() => setRawCommitMessage((v) => !v)}
                              >
                                {rawCommitMessage
                                  ? "Mostra Markdown"
                                  : "Testo originale"}
                              </button>
                            </div>
                            {rawCommitMessage ? (
                              <pre className="commit-message-raw">
                                {currentCommit.body}
                              </pre>
                            ) : (
                              <CommitMarkdown
                                text={currentCommit.body}
                                onOpenLink={(url) =>
                                  void invoke("app.external", { url }).catch(
                                    (e) => notify(String(e), true),
                                  )
                                }
                                onCopy={(code) => {
                                  void navigator.clipboard.writeText(code);
                                  notify("Codice copiato");
                                }}
                              />
                            )}
                          </>
                        )}
                        <div className="author-detail">
                          <span className="avatar">
                            {avatar(currentCommit.author)}
                          </span>
                          <div>
                            <strong>{currentCommit.author}</strong>
                            <span>{currentCommit.email}</span>
                          </div>
                        </div>
                        <div className="detail-meta">
                          <span>SHA</span>
                          <button
                            onClick={() => {
                              void navigator.clipboard.writeText(
                                currentCommit.hash,
                              );
                              notify("SHA copiato");
                            }}
                          >
                            <code>{currentCommit.shortHash}</code>
                            <Copy size={12} />
                          </button>
                          <span>Data</span>
                          <span>
                            {new Date(currentCommit.date).toLocaleString(
                              "it-IT",
                              {
                                day: "2-digit",
                                month: "short",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              },
                            )}
                          </span>
                          <span>Parent</span>
                          <span>
                            {currentCommit.parents.length
                              ? currentCommit.parents.map((p) => (
                                  <button
                                    className="parent-link"
                                    key={p}
                                    onClick={() => void selectCommit(p)}
                                  >
                                    {p.slice(0, 8)}
                                  </button>
                                ))
                              : "Commit iniziale"}
                          </span>
                        </div>
                        <div className="commit-detail-actions">
                          <button
                            className="secondary"
                            onClick={() =>
                              showAction("cherryPick", { hash: selected })
                            }
                          >
                            <GitCommitHorizontal size={14} />
                            Cherry-pick
                          </button>
                          <button
                            className="icon-button secondary"
                            title="Altre operazioni"
                            onClick={(e) =>
                              context(e, [
                                {
                                  label: "Revert commit",
                                  operation: "revert",
                                  values: { hash: selected },
                                },
                                {
                                  label: "Crea branch",
                                  operation: "branch.create",
                                  values: { start: selected },
                                },
                                {
                                  label: "Crea tag",
                                  operation: "tag.create",
                                  values: { ref: selected },
                                },
                                {
                                  label: "Reset su commit",
                                  operation: "reset",
                                  values: { ref: selected },
                                  danger: true,
                                },
                              ])
                            }
                          >
                            <MoreHorizontal size={17} />
                          </button>
                        </div>
                        <div className="file-section-header">
                          <strong>FILE MODIFICATI</strong>
                          <span>{details.files.length}</span>
                        </div>
                        <div className="detail-files">
                          {details.files.map((f) => (
                            <button
                              key={f.path}
                              className="detail-file"
                              onClick={() =>
                                void showDiff(f.path, false, selected)
                              }
                            >
                              <FileCode2 size={14} />
                              <span title={f.path}>{f.path}</span>
                              <small className="addition">+{f.additions}</small>
                              <small className="deletion">−{f.deletions}</small>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="loading-state">
                        <LoaderCircle size={20} className="spin" />
                        Caricamento commit…
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="inspector-heading">
                      <span className="wip-icon">
                        <Square size={15} />
                      </span>
                      <h3>Modifiche locali</h3>
                      <span className="badge">{snapshot.files.length}</span>
                      <button
                        className="icon-button"
                        title="Aggiorna"
                        disabled={busy}
                        onClick={() => void refresh()}
                      >
                        <RefreshCw size={14} />
                      </button>
                    </div>
                    {conflicts.length > 0 && (
                      <div className="conflicts-box">
                        <div>
                          <AlertTriangle size={15} />
                          <strong>
                            {conflicts.length} conflitti da risolvere
                          </strong>
                        </div>
                        {conflicts.map((f) => (
                          <button
                            key={f.path}
                            onClick={() => setConflictFile(f.path)}
                          >
                            {f.path}
                            <ChevronRight size={14} />
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="working-files">
                      <div className="file-section">
                        <div className="file-section-header">
                          <button
                            className="file-section-label"
                            onClick={() => groupToggle("unstaged")}
                          >
                            {collapsed.unstaged ? (
                              <ChevronRight size={12} />
                            ) : (
                              <ChevronDown size={12} />
                            )}
                            <strong>NON PREPARATI</strong>
                            <span>{unstaged.length}</span>
                          </button>
                          <button
                            disabled={!unstaged.length || busy}
                            title="Aggiungi tutti i file allo staging"
                            onClick={() => void run("stage", { files: [] })}
                          >
                            <Plus size={13} />
                            <span>Tutti</span>
                          </button>
                        </div>
                        {!collapsed.unstaged &&
                          (unstaged.length ? (
                            unstaged.map((f) => fileRow(f, false))
                          ) : (
                            <div className="files-empty">
                              <Check size={13} />
                              Nessuna modifica da preparare
                            </div>
                          ))}
                      </div>
                      <div className="file-section staged-section">
                        <div className="file-section-header">
                          <button
                            className="file-section-label"
                            onClick={() => groupToggle("staged")}
                          >
                            {collapsed.staged ? (
                              <ChevronRight size={12} />
                            ) : (
                              <ChevronDown size={12} />
                            )}
                            <strong>STAGING</strong>
                            <span>{staged.length}</span>
                          </button>
                          <button
                            disabled={!staged.length || busy}
                            title="Rimuovi tutti i file dallo staging"
                            onClick={() => void run("unstage", { files: [] })}
                          >
                            <Minus size={13} />
                            <span>Tutti</span>
                          </button>
                        </div>
                        {!collapsed.staged &&
                          (staged.length ? (
                            staged.map((f) => fileRow(f, true))
                          ) : (
                            <div className="staging-empty">
                              <div className="staging-illustration">
                                <GitCommitHorizontal size={24} />
                              </div>
                              <span>Prepara ciò che vuoi includere</span>
                              <small>
                                Usa <b>+</b> sui file o seleziona un hunk nel
                                diff
                              </small>
                            </div>
                          ))}
                      </div>
                    </div>
                    <div className="commit-composer">
                      <div className="composer-heading">
                        <span className="avatar small">
                          {avatar(boot?.settings.identityName || "Commit")}
                        </span>
                        <strong>Il prossimo commit</strong>
                        <span>{staged.length} file</span>
                      </div>
                      <input
                        className="commit-subject-input"
                        aria-label="Messaggio commit"
                        placeholder="Messaggio del commit"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                      />
                      <textarea
                        aria-label="Descrizione commit"
                        placeholder="Descrizione estesa (facoltativa)"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={3}
                      />
                      <div className="commit-options">
                        <label>
                          <input
                            type="checkbox"
                            checked={amend}
                            onChange={(e) => setAmend(e.target.checked)}
                          />
                          Amend
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={sign}
                            onChange={(e) => setSign(e.target.checked)}
                          />
                          Firma GPG
                        </label>
                        <span>
                          {subject.length > 72 ? "Messaggio lungo" : ""}
                        </span>
                      </div>
                      {amend && (
                        <div className="amend-note">
                          <AlertTriangle size={12} />
                          Amend sostituisce l’ultimo commit locale.
                        </div>
                      )}
                      <button
                        className="primary commit-button"
                        disabled={
                          busy ||
                          !subject.trim() ||
                          (!staged.length && !(amend && snapshot.head)) ||
                          conflicts.length > 0
                        }
                        onClick={() => void submitCommit()}
                      >
                        {busy ? (
                          <LoaderCircle size={16} className="spin" />
                        ) : (
                          <Check size={17} />
                        )}
                        <span>
                          {amend ? "Amend commit" : "Crea commit"}
                          {staged.length > 0 && ` · ${staged.length} file`}
                        </span>
                        <kbd>⌘ ↵</kbd>
                      </button>
                      <div className="commit-foot">
                        <ShieldCheck size={12} />
                        Il commit resta locale fino al push.
                      </div>
                    </div>
                  </>
                )}
              </aside>
            )}
          </div>
          {terminal && path && (
            <TerminalPanel path={path} onClose={() => setTerminal(false)} />
          )}
          <footer className="statusbar">
            <span>
              <GitBranch size={12} />
              {snapshot.branch || snapshot.head.slice(0, 8)}
              {snapshot.files.length > 0 && (
                <small>● {snapshot.files.length} modifiche</small>
              )}
            </span>
            <span className="statusbar-middle">
              {busy ? (
                <>
                  <LoaderCircle className="spin" size={12} />
                  Operazione in corso…
                </>
              ) : (
                <>
                  <span className="status-dot" />
                  Repository aggiornato
                </>
              )}
            </span>
            <span>
              <ShieldCheck size={12} />
              Git locale
              <span className="statusbar-divider" />
              UTF-8
              <button
                title="Aggiorna repository"
                onClick={() => void refresh()}
              >
                <RefreshCw size={11} />
              </button>
            </span>
          </footer>
        </>
      )}
      {conflictFile && snapshot && (
        <ConflictPanel
          snapshot={snapshot}
          file={conflictFile}
          onClose={() => setConflictFile(null)}
          onResolved={() => void refresh()}
        />
      )}
      {toolsOpen && snapshot && (
        <ToolsPanel
          snapshot={snapshot}
          onClose={() => setToolsOpen(false)}
          onChanged={() => void refresh()}
          onOpenAISettings={() => setAISettingsOpen(true)}
          aiSettingsVersion={aiSettingsVersion}
        />
      )}
      {aiSettingsOpen && (
        <AISettings
          onClose={() => setAISettingsOpen(false)}
          onSaved={() => setAISettingsVersion((v) => v + 1)}
        />
      )}
      {hostingSettingsOpen && (
        <HostingSettings
          snapshot={snapshot}
          onClose={() => setHostingSettingsOpen(false)}
          onSaved={() => setHostingRevision((revision) => revision + 1)}
        />
      )}
      {menu && (
        <div
          className={`context-menu ${menu.items.length > 12 ? "large-menu" : ""}`}
          style={{ left: menu.x, top: Math.max(58, menu.y) }}
          onClick={(e) => e.stopPropagation()}
        >
          {menu.items.map((item, i) => (
            <button
              key={i}
              className={item.danger ? "danger-text" : ""}
              onClick={() => {
                setMenu(null);
                if (item.operation) showAction(item.operation, item.values);
                else item.fn?.();
              }}
            >
              {item.label}
              {item.operation && (
                <span>
                  {actions.find((a) => a.id === item.operation)?.group}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {toast && (
        <div className={`toast ${toast.error ? "error" : ""}`}>
          <span>
            {toast.error ? (
              <AlertTriangle size={17} />
            ) : (
              <CheckCircle2 size={17} />
            )}
          </span>
          <div>{toast.text.replace(/^Error: /, "")}</div>
          <button className="icon-button" onClick={() => setToast(null)}>
            <X size={14} />
          </button>
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={() => !busy && setModal(null)}
        >
          <form
            className={`modal ${modal.type === "settings" ? "settings-modal" : ""}`}
            onMouseDown={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              void submitModal();
            }}
          >
            <div className="modal-top">
              <div
                className={`modal-icon ${modal.action?.danger || modal.values.confirmForce ? "danger-icon" : ""}`}
              >
                {modal.action?.danger || modal.values.confirmForce ? (
                  <AlertTriangle size={23} />
                ) : modal.type === "settings" ? (
                  <SettingsIcon size={23} />
                ) : modal.type === "clone" ? (
                  <Download size={23} />
                ) : (
                  <GitBranch size={23} />
                )}
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setModal(null)}
              >
                <X size={19} />
              </button>
            </div>
            <h2>
              {modal.action?.title ||
                {
                  clone: "Clona un repository",
                  init: "Crea un repository",
                  settings: "Preferenze",
                }[modal.type!]}
            </h2>
            <p className="modal-description">
              {modal.action?.description ||
                {
                  clone:
                    "Collega un progetto remoto a una nuova cartella locale.",
                  init: "Inizializza Git in una cartella del tuo computer.",
                  settings:
                    "Un workspace che si adatta al tuo modo di lavorare.",
                }[modal.type!]}
            </p>
            {modal.action?.id === "commit.checkout" && (
              <div className="detached-checkout-note">
                <GitCommitHorizontal size={19} />
                <div>
                  <strong>Detached HEAD</strong>
                  <p>
                    Puoi esplorare i file e i commit. Per continuare il lavoro
                    su un ramo con un nome, crea un branch da questo commit.
                  </p>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      showAction("branch.create", {
                        start: modal.values.hash,
                        checkout: true,
                      })
                    }
                  >
                    <GitBranch size={14} />
                    Crea un branch da qui
                  </button>
                </div>
              </div>
            )}
            {modal.action &&
              autoStashOperations.has(modal.action.id) &&
              snapshot?.files.length !== 0 && (
                <div className="checkout-local-changes">
                  <Layers size={14} />
                  <span>
                    {snapshot?.files.length} file con modifiche locali.
                    Autostash conserva staged, unstaged e non tracciati e tenta
                    il ripristino al termine; se ci sono conflitti mantiene un
                    riferimento di recupero.
                  </span>
                </div>
              )}
            {modal.action?.danger && (
              <div className="warning-box">
                <AlertTriangle size={15} />
                <span>
                  Questa operazione modifica la cronologia o elimina dati
                  locali. Verifica i riferimenti prima di confermare.
                </span>
              </div>
            )}
            {Boolean(modal.values.confirmForce) && (
              <div className="warning-box">
                <AlertTriangle size={15} />
                <span>
                  Conferma il force push: riscrive il branch remoto se nessun
                  altro lo ha aggiornato. Il comando usa --force-with-lease.
                </span>
              </div>
            )}
            {modal.type === "settings" ? (
              <div className="settings-fields">
                <div className="settings-ai-entry">
                  <div>
                    <strong>Provider e modelli AI</strong>
                    <p>
                      Collega chiavi, gateway cloud o modelli locali e scegli il
                      modello attivo.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setModal(null);
                      setAISettingsOpen(true);
                    }}
                  >
                    Configura AI
                  </button>
                </div>
                <div className="settings-ai-entry">
                  <div>
                    <strong>Account e server Git</strong>
                    <p>
                      Collega GitHub, GitLab, Bitbucket, Azure DevOps, Gitea o
                      Forgejo e scegli il profilo per ogni remote.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setModal(null);
                      setHostingSettingsOpen(true);
                    }}
                  >
                    Profili hosting
                  </button>
                </div>
                <label>
                  Tema
                  <select
                    value={settingsDraft.theme || theme}
                    onChange={(e) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        theme: e.target.value as "dark" | "light",
                      })
                    }
                  >
                    <option value="dark">Scuro · Graphite</option>
                    <option value="light">Chiaro · Porcelain</option>
                  </select>
                </label>
                <label>
                  Dimensione testo
                  <select
                    value={settingsDraft.fontSize || 13}
                    onChange={(e) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        fontSize: Number(e.target.value),
                      })
                    }
                  >
                    {[12, 13, 14, 15, 16].map((v) => (
                      <option key={v} value={v}>
                        {v} px
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Nome
                  <input
                    value={settingsDraft.identityName || ""}
                    onChange={(e) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        identityName: e.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    value={settingsDraft.identityEmail || ""}
                    onChange={(e) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        identityEmail: e.target.value,
                      })
                    }
                  />
                </label>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={settingsDraft.autoFetch ?? true}
                    onChange={(e) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        autoFetch: e.target.checked,
                      })
                    }
                  />
                  Fetch automatico
                </label>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={settingsDraft.autoStash ?? true}
                    onChange={(e) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        autoStash: e.target.checked,
                      })
                    }
                  />
                  Autostash per checkout, merge, rebase e pull
                </label>
                <p className="settings-autostash-description">
                  Conserva staged, unstaged e file non tracciati prima
                  dell’operazione e tenta il ripristino al termine. In caso di
                  conflitto resta disponibile un riferimento di recupero.
                </p>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={settingsDraft.showRemoteBranches ?? true}
                    onChange={(e) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        showRemoteBranches: e.target.checked,
                      })
                    }
                  />
                  Mostra branch remoti
                </label>
                <p className="fineprint">
                  Nome ed email sono i valori preferiti dell’app. Per impostarli
                  sul repository usa “Identità Git”.
                </p>
              </div>
            ) : (
              (
                modal.action?.fields ||
                (modal.type === "clone"
                  ? [
                      field(
                        "url",
                        "URL del repository",
                        "https://github.com/team/progetto.git",
                      ),
                      field(
                        "destination",
                        "Cartella di destinazione",
                        "/Users/…/Progetti/progetto",
                      ),
                    ]
                  : [
                      field(
                        "path",
                        "Cartella del repository",
                        "/Users/…/Progetti/progetto",
                      ),
                    ])
              ).map((f) => (
                <label
                  key={f.name}
                  className={
                    f.type === "checkbox" ? "checkbox-field" : "form-field"
                  }
                >
                  {f.type === "checkbox" ? (
                    <>
                      <input
                        type="checkbox"
                        checked={Boolean(modal.values[f.name])}
                        onChange={(e) =>
                          setModal({
                            ...modal,
                            values: {
                              ...modal.values,
                              [f.name]: e.target.checked,
                            },
                          })
                        }
                      />
                      {f.label}
                    </>
                  ) : (
                    <>
                      <span>
                        {f.label}
                        {f.required && <small> *</small>}
                      </span>
                      {f.type === "select" ? (
                        <select
                          value={String(
                            modal.values[f.name] || f.options?.[0] || "",
                          )}
                          onChange={(e) =>
                            setModal({
                              ...modal,
                              values: {
                                ...modal.values,
                                [f.name]: e.target.value,
                              },
                            })
                          }
                        >
                          {f.options?.map((o) => (
                            <option key={o}>{o}</option>
                          ))}
                        </select>
                      ) : f.type === "textarea" ? (
                        <textarea
                          rows={5}
                          required={f.required}
                          value={String(modal.values[f.name] || "")}
                          placeholder={f.placeholder}
                          onChange={(e) =>
                            setModal({
                              ...modal,
                              values: {
                                ...modal.values,
                                [f.name]: e.target.value,
                              },
                            })
                          }
                        />
                      ) : (
                        <div className="input-with-button">
                          <input
                            autoFocus={
                              (modal.action?.fields?.[0]?.name ||
                                (modal.type === "clone" ? "url" : "path")) ===
                              f.name
                            }
                            required={f.required}
                            placeholder={f.placeholder}
                            value={String(modal.values[f.name] || "")}
                            onChange={(e) =>
                              setModal({
                                ...modal,
                                values: {
                                  ...modal.values,
                                  [f.name]: e.target.value,
                                },
                              })
                            }
                            list={
                              ["ref", "name", "branch"].includes(f.name)
                                ? "branch-list"
                                : undefined
                            }
                          />
                          {["destination", "path"].includes(f.name) && (
                            <button
                              type="button"
                              className="icon-button"
                              title="Scegli cartella"
                              onClick={async () => {
                                const folder = await invoke<string | null>(
                                  "app.selectDirectory",
                                );
                                if (folder)
                                  setModal({
                                    ...modal,
                                    values: {
                                      ...modal.values,
                                      [f.name]: folder,
                                    },
                                  });
                              }}
                            >
                              <FolderOpen size={16} />
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </label>
              ))
            )}
            <datalist id="branch-list">
              {snapshot?.branches.map((b) => (
                <option key={b.name} value={b.name} />
              ))}
            </datalist>
            {modal.action && (
              <div className="command-preview">
                <div>
                  <Terminal size={12} />
                  <span>ANTEPRIMA COMANDO</span>
                  <button
                    type="button"
                    title="Copia comando"
                    onClick={() => {
                      void navigator.clipboard.writeText(
                        gitCommand(modal.action!.id, modal.values),
                      );
                      notify("Comando copiato");
                    }}
                  >
                    <Copy size={12} />
                  </button>
                </div>
                <code>{gitCommand(modal.action.id, modal.values)}</code>
              </div>
            )}
            {modal.action?.id === "discard" && (
              <div className="discard-files">
                {((modal.values.files as string[]) || []).map((f) => (
                  <span key={f}>
                    <FileCode2 size={13} />
                    {f}
                  </span>
                ))}
              </div>
            )}
            <div className="modal-footer">
              <button
                type="button"
                className="secondary"
                onClick={() => setModal(null)}
              >
                Annulla
              </button>
              <button
                className={
                  modal.action?.danger || modal.values.confirmForce
                    ? "danger-button"
                    : "primary"
                }
                disabled={busy}
                type="submit"
              >
                {busy && <LoaderCircle size={15} className="spin" />}
                {modal.type === "settings"
                  ? "Salva preferenze"
                  : modal.type === "clone"
                    ? "Clona repository"
                    : modal.type === "init"
                      ? "Crea repository"
                      : modal.values.confirmForce
                        ? "Conferma force push"
                        : modal.action?.danger
                          ? "Conferma operazione"
                          : "Esegui"}
              </button>
            </div>
          </form>
        </div>
      )}
      {palette && (
        <div
          className="modal-backdrop palette-backdrop"
          onMouseDown={() => setPalette(false)}
        >
          <div
            className="command-palette"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="palette-input">
              <Search size={20} />
              <input
                autoFocus
                placeholder="Cerca un comando, un branch o un repository…"
                value={paletteSearch}
                onChange={(e) => setPaletteSearch(e.target.value)}
              />
              <kbd>ESC</kbd>
            </div>
            <div className="palette-items">
              <div className="section-label">AZIONI RAPIDE</div>
              {[
                {
                  title: "Apri repository",
                  icon: FolderOpen,
                  key: "⌘ O",
                  fn: () => void openRepo(),
                },
                {
                  title: "Esplora demo isolata",
                  icon: Play,
                  key: "",
                  fn: () => void openDemo(),
                },
                {
                  title: "Crea repository",
                  icon: FolderPlus,
                  key: "",
                  fn: () => setModal({ type: "init", values: { path: "" } }),
                },
                {
                  title: "Clona repository",
                  icon: Download,
                  key: "",
                  fn: () =>
                    setModal({
                      type: "clone",
                      values: { url: "", destination: "" },
                    }),
                },
                {
                  title: "Aggiorna repository",
                  icon: RefreshCw,
                  key: "⌘ R",
                  fn: () => void refresh(),
                },
                {
                  title: "Apri terminale",
                  icon: Terminal,
                  key: "",
                  fn: () => setTerminal(true),
                },
                {
                  title: "Strumenti · confronto, rebase, patch e AI",
                  icon: Code2,
                  key: "",
                  fn: () => setToolsOpen(true),
                },
                {
                  title: "Impostazioni AI · provider e modelli",
                  icon: SettingsIcon,
                  key: "",
                  fn: () => setAISettingsOpen(true),
                },
                {
                  title: "Profili hosting · account e server Git",
                  icon: Cloud,
                  key: "",
                  fn: () => setHostingSettingsOpen(true),
                },
              ]
                .filter((a) =>
                  a.title.toLowerCase().includes(paletteSearch.toLowerCase()),
                )
                .map((a) => (
                  <button
                    key={a.title}
                    onClick={() => {
                      setPalette(false);
                      a.fn();
                    }}
                  >
                    <a.icon size={16} />
                    <span>{a.title}</span>
                    <kbd>{a.key}</kbd>
                  </button>
                ))}
              {snapshot && (
                <>
                  <div className="section-label">OPERAZIONI GIT</div>
                  {optionItems
                    .filter((a) =>
                      `${a.title} ${a.group} ${a.id}`
                        .toLowerCase()
                        .includes(paletteSearch.toLowerCase()),
                    )
                    .map((a) => (
                      <button
                        key={a.id}
                        className={a.danger ? "palette-danger" : ""}
                        onClick={() => {
                          setPalette(false);
                          showAction(a.id);
                        }}
                      >
                        <GitBranch size={15} />
                        <span>{a.title}</span>
                        <small>{a.group}</small>
                      </button>
                    ))}
                  {paletteSearch &&
                    snapshot.branches
                      .filter((b) =>
                        b.name
                          .toLowerCase()
                          .includes(paletteSearch.toLowerCase()),
                      )
                      .map((b) => (
                        <button
                          key={b.name}
                          onClick={() => {
                            setPalette(false);
                            showAction("branch.checkout", { name: b.name });
                          }}
                        >
                          <GitBranch size={15} />
                          <span>{b.name}</span>
                          <small>Checkout</small>
                        </button>
                      ))}
                </>
              )}
              {!!boot?.repos.length && (
                <>
                  <div className="section-label">REPOSITORY</div>
                  {boot.repos
                    .filter((r) =>
                      r.name
                        .toLowerCase()
                        .includes(paletteSearch.toLowerCase()),
                    )
                    .map((r) => (
                      <button
                        key={r.path}
                        onClick={() => {
                          setPalette(false);
                          void openRepo(r.path);
                        }}
                      >
                        <FolderGit2 size={16} />
                        <span>{r.name}</span>
                        <small>{r.path}</small>
                      </button>
                    ))}
                </>
              )}
            </div>
            <div className="palette-footer">
              <span>
                <Command size={12} />
                Tutte le operazioni a portata di tastiera
              </span>
              <span>Seleziona un comando</span>
            </div>
          </div>
        </div>
      )}
      {output && (
        <div className="modal-backdrop" onMouseDown={() => setOutput(null)}>
          <div
            className="output-modal"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="pane-heading">
              <Terminal size={17} />
              <h3>{output.title}</h3>
              <button
                className="icon-button"
                title="Copia output"
                onClick={() => {
                  void navigator.clipboard.writeText(
                    [output.command, output.text].filter(Boolean).join("\n"),
                  );
                  notify("Output copiato");
                }}
              >
                <Copy size={15} />
              </button>
              <button className="icon-button" onClick={() => setOutput(null)}>
                <X size={17} />
              </button>
            </div>
            {output.command && (
              <div className="output-command">
                <span>$</span>
                <code>{output.command}</code>
              </div>
            )}
            <pre>{output.text}</pre>
            <div className="modal-footer">
              <button className="secondary" onClick={() => setOutput(null)}>
                Chiudi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function Empty({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="empty-state">
      <div>{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function DiffViewer({
  text,
  mode,
  onHunk,
  staged,
  busy,
}: {
  text: string;
  mode: "unified" | "split";
  onHunk?: (patch: string) => void;
  staged: boolean;
  busy: boolean;
}) {
  const hunks = useMemo(() => {
    const lines = text.split("\n");
    const first = lines.findIndex((l) => l.startsWith("@@"));
    if (first < 0) return [];
    const header = lines.slice(0, first).join("\n") + "\n";
    const result: {
      header: string;
      lines: {
        text: string;
        kind: string;
        old: number | null;
        next: number | null;
      }[];
      patch: string;
    }[] = [];
    let i = first;
    while (i < lines.length) {
      if (!lines[i].startsWith("@@")) {
        i++;
        continue;
      }
      const start = i,
        h = lines[i++];
      const match = h.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      let old = Number(match?.[1] || 1),
        next = Number(match?.[2] || 1);
      const entries = [];
      while (
        i < lines.length &&
        !lines[i].startsWith("@@") &&
        !lines[i].startsWith("diff --git")
      ) {
        const line = lines[i++];
        if (line === "" && i === lines.length) continue;
        const kind =
          line[0] === "+"
            ? "add"
            : line[0] === "-"
              ? "delete"
              : line[0] === "\\"
                ? "meta"
                : "context";
        entries.push({
          text: line.slice(kind === "meta" ? 0 : 1),
          kind,
          old: kind === "add" || kind === "meta" ? null : old++,
          next: kind === "delete" || kind === "meta" ? null : next++,
        });
      }
      result.push({
        header: h,
        lines: entries,
        patch: header + lines.slice(start, i).join("\n") + "\n",
      });
    }
    return result;
  }, [text]);
  if (!text.trim())
    return (
      <Empty
        icon={<FileDiff size={29} />}
        title="Nessuna differenza"
        text="Questo file non ha modifiche nella selezione corrente."
      />
    );
  if (!hunks.length) return <pre className="raw-diff">{text}</pre>;
  const splitRows = (lines: (typeof hunks)[number]["lines"]) => {
    const result: {
      left: (typeof lines)[number] | null;
      right: (typeof lines)[number] | null;
    }[] = [];
    let i = 0;
    while (i < lines.length) {
      if (lines[i].kind === "delete" || lines[i].kind === "add") {
        const del: typeof lines = [],
          add: typeof lines = [];
        while (
          i < lines.length &&
          (lines[i].kind === "delete" || lines[i].kind === "add")
        ) {
          const l = lines[i++];
          (l.kind === "delete" ? del : add).push(l);
        }
        for (let j = 0; j < Math.max(del.length, add.length); j++)
          result.push({ left: del[j] || null, right: add[j] || null });
      } else {
        result.push({ left: lines[i], right: lines[i] });
        i++;
      }
    }
    return result;
  };
  return (
    <div className={`diff-scroll ${mode === "split" ? "split-diff" : ""}`}>
      {hunks.map((h, i) => (
        <section className="diff-hunk" key={i}>
          <div className="hunk-heading">
            <code>{h.header}</code>
            {onHunk && (
              <button disabled={busy} onClick={() => onHunk(h.patch)}>
                {staged ? <Minus size={12} /> : <Plus size={12} />}{" "}
                {staged ? "Unstage hunk" : "Stage hunk"}
              </button>
            )}
          </div>
          {mode === "unified"
            ? h.lines.map((l, j) => (
                <div className={`diff-line ${l.kind}`} key={j}>
                  <span className="line-number">{l.old}</span>
                  <span className="line-number">{l.next}</span>
                  <span className="line-indicator">
                    {l.kind === "add" ? "+" : l.kind === "delete" ? "−" : " "}
                  </span>
                  <code>{l.text || " "}</code>
                </div>
              ))
            : splitRows(h.lines).map((row, j) => (
                <div className="split-row" key={j}>
                  {(["left", "right"] as const).map((side) => (
                    <div
                      className={`split-line ${row[side]?.kind || "blank"}`}
                      key={side}
                    >
                      <span className="line-number">
                        {side === "left" ? row[side]?.old : row[side]?.next}
                      </span>
                      <code>{row[side]?.text || " "}</code>
                    </div>
                  ))}
                </div>
              ))}
        </section>
      ))}
    </div>
  );
}
export default App;
