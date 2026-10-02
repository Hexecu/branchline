# Internal desktop API

Renderer invokes `window.branchline.invoke(method, payload)` over isolated Electron IPC. Errors reject with a readable message. No HTTP API or browser mock. `window.branchline.on(event, callback)` returns unsubscribe.

Repository reads/actions, hosting status/test/list/bind methods, `ai.status`, `ai.generate` and `terminal.open` require a `path` previously registered by `repo.open`, `repo.init`, `repo.clone` or `app.demo`. AI configuration/import/model/test and hosting configuration methods are global and require no repository path. Repository file paths are relative to that repository. Git types are defined in `src/types.ts`; AI UI types in `src/AISettings.tsx` and hosting UI types in `src/HostingSettings.tsx`.

Methods:


- `app.bootstrap` -> Bootstrap in src/types.ts
- `app.selectDirectory` -> path or null
- `app.demo` -> Snapshot; create/reopen the owned isolated demo in Electron userData/demo
- `repo.open {path}` -> Snapshot and register recent repo
- `repo.close {path}` -> void
- `repo.snapshot {path, limit?:number, focusRef?:string}` -> Snapshot (default 400 commits; clamped to 1–5000). With `focusRef`, load that resolved commit and its ancestry without checkout. If the checked-out HEAD falls outside the ordinary window, the backend loads its ancestry so HEAD remains visible. `historyFocus:string|null` identifies the focus and `historyLimited:boolean` indicates more ancestry beyond the limit.
- `repo.clone {url, destination}` -> Snapshot
- `repo.init {path}` -> Snapshot
- `repo.diff {path, file?:string, staged?:boolean, commit?:string, from?:string, to?:string}` -> string unified diff. file is relative to repo.
- `repo.commitDetails {path, hash}` -> CommitDetails
- `repo.file {path,file,ref?:string}` -> string (working file if no ref)
- `repo.blame {path,file,ref?:string}` -> string
- `repo.history {path,file}` -> Commit[]
- `repo.conflictVersions {path,file}` -> {base:string,ours:string,theirs:string,working:string,present:{base:boolean,ours:boolean,theirs:boolean,working:boolean}}; present distinguishes a deleted stage from an empty file. Binary content rejects.
- `repo.rebasePlan {path,base}` -> Commit[] in oldest-first order; base excluded, must be an ancestor of HEAD with no merge commits in base..HEAD
- `repo.action {path, operation, ...args}` -> {output:string,command:string,autoStash?:AutoStashInfo}; refresh snapshot after success or failure, since an operation or conflict may already have changed the repository
- `app.settings {settings:Partial<Settings>}` -> Settings
- `app.reveal {path}` -> void
- `app.external {url}` -> void (HTTPS only, no embedded credentials)
- `app.activity` -> Activity[]
- `terminal.open {path}` -> {id:string}; `terminal.write {id,data}`, `terminal.resize {id,cols,rows}`, `terminal.close {id}`. events `terminal.data` {id,data}, `terminal.exit` {id,code}.
- `provider.settings {}` -> HostingConfiguration; profile metadata, credential-presence flags and remote bindings only
- `provider.save {profile:HostingProfileInput,credentials?:HostingCredentials}` -> HostingConfiguration; upsert metadata, omitted credentials retain saved values, non-empty credentials merge, explicit `{}` clears saved credentials
- `provider.delete {id:string}` -> HostingConfiguration; remove metadata, encrypted credentials and bindings using this profile
- `provider.bind {path,remote:string,profileId:string|null}` -> HostingConfiguration; associate the repository/remote pair with a saved profile, or automatic public/GitHub CLI mode for null. Other remote bindings are retained; Git URLs are unchanged.
- `provider.status {path,remote?:string,profileId?:string}` -> HostingStatus; read repository metadata using the explicit profile or saved remote binding. Authentication failures return `authenticated:false` with a readable message.
- `provider.test {path,remote?:string,profileId?:string}` -> HostingStatus; same read-only repository check, no writes
- `provider.prs {path,remote?:string,profileId?:string}` -> HostingItem[]; up to 50 open pull/merge requests
- `provider.issues {path,remote?:string,profileId?:string}` -> HostingItem[]; up to 50 open issues or Azure project work items. Unsupported capabilities and listing failures reject rather than returning an empty success.
- `ai.settings {}` -> AIConfiguration; metadata and credential-presence flags only
- `ai.save {profile:AIProfileInput,credentials?:AICredentials}` -> AIConfiguration; upsert profile, omitted credentials retain saved values, non-empty partial credentials merge, explicit `{}` clears credentials
- `ai.remove {id:string}` -> AIConfiguration; remove metadata and encrypted credentials, choose another active profile if needed
- `ai.activate {id:string,model?:string}` -> AIConfiguration; select saved profile and optionally persist an exact non-empty model ID, no inference
- `ai.models {profileId?:string}` -> {models:string[],message:string}; use the active profile if omitted, return readable empty discovery on error; a catalog does not prove inference access
- `ai.test {profileId?:string,model?:string}` -> {text:string,model:string,profileId:string,durationMs:number}; real inference with a synthetic prompt, no repository data
- `ai.import {sourcePath?:string}` -> AIConfiguration; optional absolute local file path, otherwise native file picker. Cancel returns unchanged configuration. JSON/environment import does not infer; the first imported profile with a model becomes active.
- `ai.importHarness {sourcePath?:string}` -> AIConfiguration; use an absolute local configuration file path without NUL, or open a native JSON/environment file picker when omitted. Cancel returns unchanged settings. Import the selected LiteLLM gateway as `harness-os`, explicitly select `gemini-3.5-flash` and activate it. No inference or automatic search of private directories.
- `ai.status {path}` -> {available:boolean,models:string[],message:string}; discover models for the active profile. `available` means an active profile exists, not that authentication/inference succeeded.
- `ai.generate {path,profileId?:string,model?:string,prompt:string,diff:string}` -> suggestion string; infer with explicit or saved exact model and profile, no Git action or automatic application

Git action operation / args:


- stage, unstage, discard: files:string[] (empty means all for stage/unstage; discard requires files)
- untrack, ignore: files:string[] (non-empty); ignore writes root .gitignore, untrack removes from index while retaining disk content
- discard.restore: backup:string (ID from the discard result/activity)
- commit: message:string, description?:string, amend?:boolean, sign?:boolean
- branch.create: name:string, start?:string, checkout?:boolean
- branch.checkout: name:string, autoStash?:boolean
- commit.checkout: hash:string, autoStash?:boolean (resolved hexadecimal commit; detached HEAD with a recovery ref for the previous HEAD)
- branch.rename: name:string, newName:string
- branch.delete: name:string, force?:boolean
- merge: ref:string, squash?:boolean, autoStash?:boolean
- rebase: ref:string, autoStash?:boolean
- interactive.rebase: base:string, plan:{hash:string,action:'pick'|'reword'|'squash'|'fixup'|'drop',message?:string}[]
- cherryPick, revert: hash:string
- reset: ref:string, mode:'soft'|'mixed'|'hard'
- undo, redo: recorded local commit/reset, guarded by original branch and expected HEAD
- fetch: remote?:string, prune?:boolean
- pull: remote?:string, rebase?:boolean, autoStash?:boolean (requires an upstream; fetches before checking integration targets)
- push: remote?:string, branch?:string, force?:boolean, setUpstream?:boolean (force uses --force-with-lease)
- stash.create: message?:string, includeUntracked?:boolean
- stash.apply: ref:string, index?:boolean (stash ordinal, saved stash OID or recovery ref; `index` restores staged state)
- stash.pop: ref:string, index?:boolean (stash-list ordinal; conflicts keep the entry)
- stash.drop: ref:string (stash-list ordinal; a recovery ref is created first)
- tag.create: name:string, ref?:string, message?:string
- tag.delete: name:string
- remote.add: name:string,url:string; remote.remove: name:string; remote.setUrl: name:string,url:string
- worktree.add: destination:string, branch?:string, newBranch?:string (outside current repo)
- worktree.remove, worktree.lock, worktree.unlock: destination:string (existing linked worktree, not current repo)
- operation.continue, operation.abort: kind:'merge'|'rebase'|'cherry-pick'|'revert'
- conflict.resolve: file:string, strategy:'ours'|'theirs' OR content:string (then stage); remove:true stages a deletion. Choosing an absent ours/theirs stage also stages deletion, while an existing empty stage retains an empty file.
- hunk.stage, hunk.unstage: patch:string
- patch.apply: patch:string, staged?:boolean (staged uses --index); applicability is checked first
- patch.export: same diff options as repo.diff; returns unified diff in output
- identity: name:string,email:string
- gitflow.init: main:string,develop:string; gitflow.start: kind:'feature'|'release'|'hotfix',name:string; gitflow.finish: kind,name
- submodule.add: url:string,destination:string; submodule.update
- lfs.status: no args; lfs.track: file:string (Git LFS must be installed)

Interactive rebase requires a clean worktree and no active operation. The plan contains every commit returned by repo.rebasePlan exactly once, in the requested replay order. The first retained row cannot use squash/fixup. A recovery ref is created; conflicts can be handled with conflict.resolve and operation.continue/abort. During a rebase, ours is the new base and theirs the replayed commit.

Discard saves selected file contents before removal/restoration, and restore preserves current contents too. Hard reset saves tracked/untracked work in a recovery stash and refuses ignored files obstructing the target tree. Mixed reset preserves index snapshots. Recovery refs are excluded from the visible graph. Undo does not cover arbitrary shell commands.

Settings: theme dark/light; fontSize 11–20; autoFetch/autoStash/showRemoteBranches booleans; defaultPath/identityName/identityEmail strings; language one of `en`, `it`, `es`, `fr`, `de`, `pt-BR`, `ja`, `zh-CN`. New installations default to `en`; existing saved Italian remains `it`. `app.settings {settings:{language}}` persists a partial update and rebuilds native menus. Language selection applies immediately in the renderer; other preferences retain their explicit Save action. See [LANGUAGES.md](docs/LANGUAGES.md). Identity preferences do not update Git config: use the identity action. Auto-fetch is off by default; when enabled it fetches/prunes the active repository every two minutes. Autostash is enabled by default in Preferences and can be disabled globally or in an operation dialog. The renderer passes that choice explicitly; IPC fills an omitted choice from the preference. The Git service itself stashes only for explicit `autoStash:true` on checkout, merge, rebase or pull.

Autostash preserves staged, unstaged and untracked changes; ignored files are excluded and target obstructions are refused. Each stash has a stable OID and recovery ref. Pending state is stored per worktree and exposed as optional `Snapshot.autoStash`: `{hash,ref,restored,conflict,operation?,originalBranch?,originalHead?,awaitingOperation?:string|null}`. Restoration uses `--index` after a completed operation, or after a matching Continue/Abort actually exits it. Successful restoration clears pending state but keeps the stash entry and recovery ref: stash ordinals can change in another Git process. A restore conflict retains recovery data and is separate from an active Git merge/rebase conflict. Manual restoration or an explicit successful drop of the pending entry clears its pending record; a drop retains the recovery ref. External shell commands are outside the app's mutation queue.

AIConfiguration is `{profiles:AIProfile[],activeProfileId:string|null}`. Profile metadata fields are `id,name,provider,model,baseUrl?,apiVersion?,project?,location?,region?,awsProfile?,authMode?`; public reads add `hasCredential:boolean`, never credential values. Providers are `openai|azure|vertex|google|litellm|bedrock|ollama|compatible`. AICredentials supports `apiKey,bearerToken,accessKeyId,secretAccessKey,sessionToken,serviceAccount`; serviceAccount is JSON text (the service also accepts a validated account object). IDs reject reserved prototype names. Profile mutations are serialized; credential updates are rolled back if metadata persistence fails. Removing a profile deletes its credentials too.

AI endpoints require HTTPS except HTTP on loopback; embedded URL credentials, query/fragments in base URLs and redirects reject. Exact model IDs are retained, with no alternative-model fallback. Azure uses the configured deployment name: dated apiVersion selects the deployment REST route, otherwise `/openai/v1/chat/completions`. Vertex uses Google `generateContent` with project/location and a Gemini ID; Azure and Vertex discovery intentionally returns manual-configuration guidance. Google discovery filters generateContent models. Bedrock uses native Converse with API key or AWS SigV4/profile credentials; its TEXT/inference-profile catalog does not prove permissions or Converse/ON_DEMAND support. OpenAI/LiteLLM/compatible use chat completions.

Ollama defaults to http://127.0.0.1:11434 and requires loopback. Discovery accepts GGUF metadata, size above 1 MiB and no cloud name or remote_host/remote_model fields. Before generation, `/api/show` must declare GGUF, an architecture, completion capability and no remote fields. These checks identify advertised local models; the external runtime remains trusted.

The diff is labelled untrusted source data. Prompt must be non-empty, at most 8000 characters; diff non-empty, at most 100000 characters. Both reject NUL, and the combined system/prompt/diff UTF-8 budget is 48000 bytes, with no silent truncation. HTTP responses/output are bounded to 2 MiB. Discovery normally times out after 15 seconds (Ollama tags five; show ten); inference is non-streaming with a three-minute timeout and 1024-token output limit. Empty output rejects, length-limited output adds a review notice. Known credentials are redacted from errors and results.

Electron main stores metadata in userData/ai/profiles.json and encrypted base64 ciphertext in userData/ai/credentials.json via safeStorage. Credentials are never returned through the read API. Vault writes are atomic with directory mode 0700 and file mode 0600. Unavailable encryption or Linux basic_text rejects: there is no plaintext fallback. See [docs/AI.md](docs/AI.md) for UI, import formats, provider authentication and validation boundaries.

HostingConfiguration is `{profiles:HostingProfile[],bindings:{repo:string,remote:string,profileId:string|null}[]}`. Profile metadata fields are `id,name,provider,baseUrl,username?,apiVersion?,authMode`; public reads add `hasCredential:boolean`. Providers are `github|gitlab|bitbucket-cloud|bitbucket-server|azure-devops|gitea|forgejo`. HostingCredentials supports `apiKey,bearerToken`; no saved value is returned. Profiles and bindings are limited to 100 and 1000 respectively. Azure defaults to API version `7.1`; Server installations can select another supported version.

Hosting auth modes: GitHub `token|bearer|gh|none`; GitLab, Gitea and Forgejo `token|bearer|none`; Bitbucket Cloud and Azure `basic|bearer|none`; Bitbucket Server `token|basic|bearer|none`. GitHub and Bitbucket Server token mode use Bearer; GitLab token mode uses `PRIVATE-TOKEN`; Gitea/Forgejo use `Authorization: token`. Basic uses `username:apiKey` (Azure username optional; Bitbucket Cloud uses the account email). Bearer uses `bearerToken`. Known public hosts can use inferred public access; unauthenticated GitHub REST permission failures can fall back to the installed `gh` on the selected host for status and lists. Custom hosts require an explicit profile. Multiple remotes with no binding require explicit selection; without an explicit remote, the most recently saved repository binding is used.

HostingStatus is `{available,authenticated,message,provider?,host?,remote?,repository?,profileId?,capabilities:{prs:boolean,issues:boolean,issueScope?:'project'|'repository'},remotes:HostingRemote[]}`. It verifies the selected repository read, not universal permissions. HostingItem exposes `{id,number,title,state,author:{login},url,updatedAt,isDraft,headRefName,baseRefName,labels:{name}[]}`. Provider state strings are retained; draft is separate. IDs must be positive safe integers or equivalent numeric strings. GitHub/Gitea/Forgejo issue lists exclude pull requests. Bitbucket Cloud/Server have `issues:false`; Azure uses a project WIQL read query and work-item batch read, excluding the literal states `Closed`, `Done` and `Removed` rather than classifying every custom workflow state.

Hosting uses native REST with HTTPS or loopback HTTP, no embedded URL credentials/query/fragment, and no redirects. Host, HTTPS port, server prefix and Azure organization/collection must match the selected remote before credentials are sent. Ordinary SSH, scp-style, nested GitLab paths, Bitbucket `scm` and Azure `v3`/`_git` formats are parsed; SSH configuration aliases are not resolved. Pagination is confined to the original origin and endpoint, capped at five pages and 50 returned items. HTTP requests time out after 15 seconds with a 3 MiB response limit; `gh` has a 30-second limit. Known credentials are redacted from textual results/errors; external links are checked for scheme, origin, userinfo and secret-bearing query parameters. GitHub Enterprise `gh` mode rejects custom ports/prefixes; use a token profile for those configurations.

Hosting metadata/bindings are stored in `userData/hosting/profiles.json`, encrypted credentials in `userData/hosting/credentials.json` using the same vault policy as AI. Hosting profile mutations are serialized and credential changes roll back on metadata persistence failure. These profiles do not modify Git authentication or remote URLs. See [docs/HOSTING.md](docs/HOSTING.md).

Events exposed by the preload: repo.changed {path}, terminal.data {id,data}, terminal.exit {id,code}, app.command ('open'|'palette'|'settings'). Other event names reject. Terminal commands run in the actual shell and are outside the recovery journal. Hosting listing methods are read-only; failures reject and capabilities identify unsupported functions.

No mutation on a user repository during development tests. Use an isolated fixture.

See [docs/VALIDATION.md](docs/VALIDATION.md) for automated/native/external validation boundaries.
