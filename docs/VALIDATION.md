# Validation

Validation dates: 2026-10-01–02. Desktop: macOS arm64, Electron 44.5.1. This record separates automated checks, observed desktop behavior and external requirements.

## Automated checks

The final `npm test` run passed **98 tests, zero failures**: 24 Git, 25 autostash/history, 17 hosting, four presentation, 14 AI adapter, seven importer and seven vault tests. Git fixtures are temporary synthetic repositories. The original Git tests also passed with Apple Git 2.39.5, alongside Git 2.44.

Git coverage includes real DAGs, refs, index/hunk staging, untracked/empty files, discard recovery, stash, merge/rebase/cherry-pick/revert, interactive rebase, protected undo/redo, local remotes, worktrees, Git Flow feature operations, path traversal and option injection. Modify/delete conflicts distinguish an absent file from a present empty file.

Autostash/history tests cover staged, unstaged and untracked preservation, deferred restoration, recovery references, failures and focused navigation. Hosting tests use simulated API/CLI responses to check provider routes, authentication, remote/profile bindings, normalization and error handling. Presentation tests cover Markdown HTML/link safety, emoji aliases, large messages and supplied graph row geometry; they do not prove native layout measurements.

AI tests use simulated HTTP/SDK responses. They verify provider routes and authentication, exact model selection, discovery, bounded input/output, credential redaction, safe import and vault behavior. They do not prove access to every cloud account. Vault unit tests simulate encryption; real macOS safeStorage was exercised separately.

## Desktop behavior observed in 0.1.0/0.2.0

The following flows were performed in packaged versions 0.1.0/0.2.0 against synthetic repositories and checked against actual Git state:

| Flow                   | Observed result                                                                                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Startup and demo       | Real history, branches, tags, stash, worktrees and a local bare remote.                                                                                                                      |
| Diff and staging       | Unified/split diff and partial hunk staging update the actual index.                                                                                                                         |
| Commit, undo and redo  | Commit creation and protected recovery produce consistent state.                                                                                                                             |
| Branch and stash       | Branch creation, stash including untracked files, and stash application succeed.                                                                                                             |
| Merge conflicts        | Manual resolution, stage and Continue finish a merge. Modify/delete can preserve an empty file or stage a deletion.                                                                          |
| Interactive rebase     | Reword succeeds with a recovery ref; conflict continuation has engine coverage.                                                                                                              |
| History and comparison | Real file history, blame and comparison between refs.                                                                                                                                        |
| Terminal               | Native PTY runs a shell in the selected repository.                                                                                                                                          |
| Repository isolation   | Switching repository clears pending action/amend state.                                                                                                                                      |
| Themes                 | Light/dark themes persist after restart.                                                                                                                                                     |
| AI settings            | Eight providers, import, model selection, saved credential presence and synthetic test.                                                                                                      |
| LiteLLM inference      | A configured gateway generated text with exact model `gemini-3.5-flash`, suggested a message for a synthetic diff, and worked after restart. Credentials and gateway addresses are excluded. |
| Local inference        | Ollama discovered seven locally declared models; `qwen2.5:3b` generated a synthetic response and a demo-diff suggestion.                                                                     |
| Credential storage     | Real macOS safeStorage encrypted a credential; plaintext absent from stored profile/vault files. Directory 0700, files 0600.                                                                 |

## Desktop behavior observed in 0.3.0

The final source was exercised in a separate native preview against owned synthetic fixtures. Git state and file hashes were checked alongside the UI.

| Flow                                  | Observed result                                                                                                                                                                                                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default autostash and branch checkout | An omitted setting defaults to on. Double-clicking a branch checked it out while preserving staged, unstaged and untracked contents and Git status. The generated stash and recovery reference remained available.                                               |
| Graph-node checkout                   | Double-clicking the SVG commit node opened the detached-HEAD confirmation with autostash checked, then checked out the selected historical commit. Local diffs were preserved and the stash retained. Double-clicking a branch returned to named-branch history. |
| Hosting configuration                 | The UI saved a public-access profile without a token, reported the repository reachable in its read-only test, and persisted its repository/remote binding. The final sidebar entry is **Integrazioni**.                                                         |
| Packaged restart                      | Reopening the final 0.3.0 macOS bundle preserved the hosting binding, automatically selected the configured GitLab remote, and loaded 50 merge requests and 50 issues again.                                                                                     |
| Live GitLab                           | The selected public GitLab remote returned 50 merge requests and 50 issues, matching the bounded-list limit.                                                                                                                                                     |
| Live GitHub                           | A selected public GitHub remote returned successful empty PR and issue lists, rather than a retrieval error.                                                                                                                                                     |
| Local AI retest                       | Ollama answered an explicit synthetic connection test in 10.47 seconds. Earlier live LiteLLM/model and macOS credential-storage results remain recorded above.                                                                                                   |

These hosting requests used public repositories. Enterprise servers and authenticated hosting adapters have simulated coverage, not live account validation. AI adapter support likewise does not establish access to every cloud model.

Screenshots in `docs/screenshots/` use synthetic demo or public hosting data. Workspace, diff and AI images were captured in an earlier 0.3 preview and may retain an older navigation label. Hosting settings show the public GitLab profile and successful test; the integration list was captured in the final packaged app, reading a public remote attached to the isolated demo. Each image illustrates the UI version in which it was captured.

## Build and CI

The final `npm run package` passed, including TypeScript checking, the renderer build and creation of the **0.3.0 macOS arm64 bundle**. Native checks above were performed separately from packaging. Public binary signing/notarization is not configured.

GitHub CI is configured for locked installation, isolated tests and a build in four Ubuntu/macOS × Node 22/24 combinations. Its remote run is pending at this checkpoint; no green Actions result is claimed.

## External requirements and limits

- OpenAI, Azure, Vertex, Google AI Studio and Bedrock adapters have automated coverage; their accounts were not exercised with real credentials.
- Hosting API access depends on the selected remote, server, profile and permissions. Public GitHub/GitLab were exercised live; enterprise servers, Bitbucket, Azure DevOps, Gitea and Forgejo were not. GitHub CLI is optional for GitHub profiles. A successful repository test does not establish write access or access to every list API.
- Remote Git authentication, signing, Git LFS and remote submodules require their external configuration. Git transport was tested with a local remote.
- AI output needs human review; suggestions do not execute commands or edit files.
- The terminal runs the user's shell and is outside the recovery journal.
- History is bounded; recovery refs are retained and excluded from the visible graph.

See the [feature matrix](FEATURES.md), [guide](GUIDE.md), [hosting profiles](HOSTING.md), [AI settings](AI.md) and [IPC contract](../API.md).
