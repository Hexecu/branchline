# Features and scope

Branchline is a local desktop Git client with an original interface. It follows familiar visual Git workflows and does not claim complete feature parity with GitKraken. This matrix describes the implemented UI and backend; [VALIDATION.md](VALIDATION.md) records which workflows were exercised in the native app.

| Area | Implemented behavior | Entry point |
| --- | --- | --- |
| Repositories | Open, initialize, clone, recent repositories, tabs and an isolated demo. | Welcome screen, + button and command palette. |
| History | Graph derived from real commit parents, independently selectable full branch/tag names, resizable reference column, search, commit details and diffs. Nodes follow measured row heights. | Graph; select a commit/ref or use its context menu. |
| Changes | File/hunk staging and unstaging, commit/amend, recoverable discard, ignore and stop tracking. | Changes panel; select a file for its diff and context menu. |
| Compare and file history | Diffs between refs, file contents, history and blame. | Tools → Compare/File history; diff toolbar. |
| Branches and checkout | Create, checkout, rename, delete, merge/squash, rebase, cherry-pick, revert and reset. Branch double-click checks out that branch; commit double-click opens a detached-HEAD confirmation with a new-branch alternative. | Navigator, graph refs/rows, context menus, operations menu and palette. |
| Interactive rebase | Ordered pick/reword/squash/fixup/drop plan, conflict resolution and continuation. | Tools → Interactive rebase. |
| Recovery | Commit/reset undo and redo guarded by branch and HEAD; recovery refs/index snapshots, reflog and discard restoration. Autostash preserves staged, unstaged and untracked changes across checkout, merge, rebase and pull; restoration conflicts retain recovery data. | Undo/Redo toolbar, activity, operation banner and stash navigator. Autostash defaults on; Preferences and operation dialogs allow opt-out. |
| Conflicts | Base/ours/theirs content, editable result, stage deletion or resolution, continue/abort. | Select a conflicted file; operation banner and palette. |
| Synchronization | Remotes, fetch/prune, pull/rebase, push/upstream; force push uses `--force-with-lease`. | Fetch/Pull/Push toolbar and operations menu. |
| Stashes and tags | Create/apply/pop/drop stashes; lightweight and annotated tags. | Stash toolbar, navigator and context menus. |
| Worktrees | List, create, open, lock, unlock and remove linked worktrees. | Worktree navigator and palette. |
| Git extensions | Identity, configured GPG signing, Gitflow, submodules and installed Git LFS status/track. | Palette/menus; signing in the commit composer. |
| Patches | Import and export textual diffs as local files. | Tools → Patches. |
| Commit messages | Emoji aliases and a safe Markdown subset: headings, lists/tasks, emphasis, links, quotes and fenced code. Raw HTML and image loading are excluded; very large bodies remain available as original text. | Commit details; HTTPS links open externally. |
| Optional AI | OpenAI, Azure OpenAI, Vertex/Gemini, Google AI Studio, LiteLLM, Bedrock, Ollama and compatible profiles; environment/JSON import, exact model selection and text suggestions from a diff. Encrypted credential storage. | Preferences → Configure AI; Tools → AI assistant → Profiles and models. See [AI.md](AI.md). |
| Desktop | Dark/light themes, text preferences, local settings, native menus and a real PTY terminal. | Top controls, Preferences and Terminal toolbar. |
| Languages | English, Italian, Spanish, French, German, Brazilian Portuguese, Japanese and Simplified Chinese; immediate local preference persistence and locale-aware dates/numbers. Repository content remains unchanged. | Welcome screen language control or Preferences → Interface language. See [LANGUAGES.md](LANGUAGES.md). |
| Git hosting | Read-only profiles and remote bindings for GitHub/Enterprise, GitLab/self-managed, Bitbucket Cloud/Server, Azure DevOps/Server, Gitea and Forgejo. PR/MR lists, supported issue lists and external links. Public access or encrypted token profiles; GitHub CLI optional. | Preferences → Hosting profiles; Integrations remote selector. See [HOSTING.md](HOSTING.md). |

New installations start in English; an existing saved Italian language preference remains Italian. The graph and Git actions operate on the selected real repository. The terminal runs an actual shell and is outside the recovery journal.

Autostash defaults on for checkout, merge, rebase and pull, with an opt-out in Preferences and operation dialogs. It restores the index after completion or a matching Continue/Abort. The stash entry and recovery ref remain available even after successful restoration. Restore conflicts have a separate recovery banner; ignored files are excluded from the stash and obstructing ignored content blocks the operation.

## Current limits

- AI output is text for human review. AI recomposition, automatic conflict suggestions and coding-agent session management are not implemented.
- Selective staging supports files and hunks, not individual lines.
- The graph loads 400 commits by default, with an API limit of 5000. Selecting a ref outside the current window loads its ancestry; an old checked-out HEAD also gets a focused window. Automatic pagination and an unbounded full-history graph are not implemented.
- Branch hide/solo, reorderable graph columns, graph drag and drop, multi-commit cherry-pick and simultaneous WIP views across worktrees are not implemented.
- Repository tabs and hosting account profiles are available. Shared workspaces and bulk operations across repositories are not implemented.
- Git LFS exposes status/track. Other LFS operations use the installed Git CLI through the terminal.
- Cloud patch sharing, PR creation/reviews/comments and issue editing are not implemented.
- Hosting adapters expose read-only lists, with up to 50 results. Bitbucket Cloud/Server do not expose native issues; Azure lists project work items rather than repository issues. Custom server versions, permissions and authentication gateways are not universally validated. Jira and Trello adapters are not implemented.
- GitKraken Cloud Workspaces, Team Launchpad, Insights and organization-wide conflict awareness depend on services that Branchline does not reproduce.
- AI discovery is a catalog, not proof of inference access. Azure deployment names and Vertex Gemini IDs are entered manually. Requests use the exact selected model without an alternative-model fallback.
- The packaged build currently targets macOS. Ad-hoc signature integrity is checked before distribution; Developer ID signing and notarization are not provided. Windows/Linux packaging is outside the recorded release validation. See [MACOS.md](MACOS.md).

The project does not include proprietary GitKraken source, branding or assets. Its original icon is separate from the Lucide interface icons. Fonts use CSS family names and system fallbacks; no font binaries are bundled.

## Isolated demo

The demo creates only its own `orbit-workspace`, `orbit-origin.git` and `orbit-offline` directories. It starts with 25 sample commits, four active local branches, two merges, three tags, a stash, an additional worktree and staged/unstaged changes. The bare remote is local. Authors and content are fictional.

Reopening an owned demo preserves its history and edits. Existing directories without the ownership marker are refused. Demo tests confirmed history/ref counts, both worktrees, working-tree state, generated JavaScript syntax and preservation of existing data.

## Validation boundaries

Git tests use temporary repositories and a local bare remote. AI and hosting adapter tests use synthetic HTTP responses and injected runtimes; import/vault tests use synthetic credentials and a mock encryption provider. Component tests exercise HTML/link safety, large commit messages and supplied graph row metrics. They do not prove browser measurement or native layout. These tests do not establish external account permissions, model quality, production Keychain behavior or every GUI workflow.

Use `npm test` for the automated suite and `npm run build` for TypeScript/frontend checks. Native application results, packaging and optional dependencies are recorded separately in [VALIDATION.md](VALIDATION.md). Provider configuration and AI verification boundaries are described in [AI.md](AI.md); security and disclosure guidance is in [SECURITY.md](../SECURITY.md).

## Comparison references

- [GitKraken Desktop interface](https://help.gitkraken.com/gitkraken-desktop/interface/)
- [File, hunk and line staging](https://help.gitkraken.com/gitkraken-desktop/staging/)
- [Undo and redo](https://help.gitkraken.com/gitkraken-desktop/undo-and-redo/)
- [Local features and service dependencies](https://help.gitkraken.com/gitkraken-desktop/self-hosted/)
- [Worktrees](https://help.gitkraken.com/gitkraken-desktop/worktrees/)
