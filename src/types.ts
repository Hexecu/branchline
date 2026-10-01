export interface Commit {
  hash: string;
  shortHash: string;
  parents: string[];
  author: string;
  email: string;
  date: string;
  subject: string;
  refs: string[];
  body?: string;
}
export interface FileChange {
  path: string;
  oldPath?: string;
  index: string;
  worktree: string;
  staged: boolean;
  unstaged: boolean;
  conflict: boolean;
}
export interface Branch {
  name: string;
  hash: string;
  current: boolean;
  remote: boolean;
  upstream: string;
  ahead: number;
  behind: number;
}
export interface Tag {
  name: string;
  hash: string;
  subject: string;
}
export interface Stash {
  ref: string;
  hash: string;
  subject: string;
  date: string;
}
export interface Remote {
  name: string;
  fetch: string;
  push: string;
}
export interface Worktree {
  path: string;
  head: string;
  branch: string;
  bare: boolean;
  locked: boolean;
}
export interface Reflog {
  hash: string;
  ref: string;
  subject: string;
  date: string;
}
export interface Snapshot {
  path: string;
  name: string;
  branch: string;
  head: string;
  upstream: string;
  ahead: number;
  behind: number;
  files: FileChange[];
  commits: Commit[];
  branches: Branch[];
  tags: Tag[];
  stashes: Stash[];
  remotes: Remote[];
  worktrees: Worktree[];
  reflog: Reflog[];
  operation: string | null;
  gitVersion: string;
}
export interface ChangedFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}
export interface CommitDetails {
  commit: Commit;
  files: ChangedFile[];
  diff: string;
}
export interface Settings {
  theme: "dark" | "light";
  fontSize: number;
  autoFetch: boolean;
  autoStash: boolean;
  showRemoteBranches: boolean;
  defaultPath: string;
  identityName: string;
  identityEmail: string;
  language: string;
}
export interface RepoEntry {
  path: string;
  name: string;
}
export interface Activity {
  id: string;
  time: string;
  repo: string;
  operation: string;
  command: string;
  success: boolean;
  output: string;
}
export interface Bootstrap {
  repos: RepoEntry[];
  activeRepo: string | null;
  settings: Settings;
  activity: Activity[];
  version: string;
}
export type Payload = Record<string, unknown>;
export interface Bridge {
  invoke<T = any>(method: string, payload?: Payload): Promise<T>;
  on(event: string, callback: (payload: any) => void): () => void;
}
declare global {
  interface Window {
    branchline: Bridge;
  }
}
