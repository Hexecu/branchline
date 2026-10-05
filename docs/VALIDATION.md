# Validation

## Build download security update, 2026-10-05

The development-only chain `electron-builder → app-builder-lib → @electron/get 3 → got → cacheable-request → http-cache-semantics` included [CVE-2026-93748](https://github.com/advisories/GHSA-ch52-4w7c-c8xp). A scoped override for `app-builder-lib 26.15.3` now uses the official `@electron/get 5.1.0`, removing the affected cache implementation and its entire dependency chain. `undici 7.30.0` is a required development dependency for proxy dispatchers. Full `npm audit`, including build tools, reports zero vulnerabilities for this lockfile; CI runs that full audit. This check is dated and does not promise future vulnerability absence.

The build-only preload wraps the pinned official FetchDownloader transport without changing global fetch or the application's network code. It retains a whole-request deadline, caller cancellation, standard HTTP(S) environment proxies and `NO_PROXY`, progress reporting and the status/network error fields used by the builder's retry policy. Owned dispatchers close after success and are destroyed after failed requests, including unconsumed error bodies. Arbitrary agents, insecure TLS settings, invalid proxy credentials and unsupported legacy transport options fail explicitly before a request. Enterprise certificate roots can still use `NODE_EXTRA_CA_CERTS`.

Eleven isolated loopback regressions exercise actual builder mirror downloads and HTTP 503 retry, checksum acceptance/rejection, warm and corrupted caches, cache bypass, stalled headers/body, caller cancellation, real socket cleanup, authenticated proxy routing and bypass, concurrent downloads, credential isolation across redirects and absence of cross-user HTTP cache replay. The tests also verify the private CLI preload preserves global fetch and the global dispatcher. They use synthetic data and no OS keychain or production service. Native CI uses a fresh temporary builder cache for each of the six targets so package verification exercises the changed download path; its existing source, license, sandbox, native PTY and desktop checks remain enabled. New signed installers or a fresh native matrix require their own completed evidence.

Local macOS arm64 acceptance passed 193 isolated tests and all 13 packaged desktop checks. Packaging downloaded the 130,259,261-byte official Electron 44.5.1 archive into a new owned cache; SHA-256 `1d75703019bb16461ae65f3081d7e6f5c0b11e901d0ccb5c343bcf7bcdd6435c` matches the reviewed upstream snapshot. The package passed all 39 byte-for-byte application source comparisons, upstream notice hashes, native PTY execution, strict ad-hoc signature/ASAR integrity and actual renderer sandbox verification. This test neither installs nor publishes the application and does not establish new notarization. Package output is canonicalized after creating the owned directory so macOS `/var` aliases cannot falsely reject the matching native module path; a symlink/junction regression covers that behavior.

Validation dates: 2026-10-01–02. Desktop: macOS arm64, Electron 44.5.1. This record separates automated checks, observed desktop behavior and external requirements.

## Automated checks

The current local 0.4.0 `npm test` run passed **116 tests, zero failures**: the existing 98 checks (24 Git, 25 autostash/history, 17 hosting, four presentation, 14 AI adapter, seven importer and seven vault), plus seven localization, nine macOS release-pipeline and two preference-persistence tests. Git fixtures are temporary synthetic repositories. The original Git tests also passed with Apple Git 2.39.5, alongside Git 2.44.

Git coverage includes real DAGs, refs, index/hunk staging, untracked/empty files, discard recovery, stash, merge/rebase/cherry-pick/revert, interactive rebase, protected undo/redo, local remotes, worktrees, Git Flow feature operations, path traversal and option injection. Modify/delete conflicts distinguish an absent file from a present empty file.

Autostash/history tests cover staged, unstaged and untracked preservation, deferred restoration, recovery references, failures and focused navigation. Hosting tests use simulated API/CLI responses to check provider routes, authentication, remote/profile bindings, normalization and error handling. Presentation tests cover Markdown HTML/link safety, emoji aliases, large messages and supplied graph row geometry; they do not prove native layout measurements.

Localization checks cover complete templates for all eight languages, matching placeholders, actual static UI/native-menu calls, safe text interpolation, consistent catalog entries, locale dates/numbers and calendar-day comparisons across daylight-saving changes. These checks do not establish native visual quality or human linguistic review.

Preference-persistence checks inject a failed storage write, require restoration of the previous in-memory settings, and verify that a later unrelated save cannot reintroduce the failed language selection. Successful partial saves preserve untouched settings and repository data.

Release-pipeline checks simulate native tools and certificate responses. They cover identity selection, fail-closed configuration, bounded/redacted diagnostics, signed build flags, notarization acceptance, stapling/Gatekeeper failures and final archive creation. These tests perform no real signing, Keychain lookup or Apple submission; a simulated `Accepted` response is not notarization evidence.

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

## Desktop behavior observed in 0.4.0

The native source preview was exercised against the isolated demo. The final 0.4.0 production bundle was then opened from the cache build directory with the normal application profile. These are separate checks; neither establishes downloaded-app trust.

| Flow                               | Observed result                                                                                                                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language discovery                 | Preferences listed all eight native language names, with language first; the header language button opened the same preference.                                                                                           |
| Immediate switching                | Interface and native menu labels changed immediately. English graph, Tools and AI settings were inspected.                                                                                                                |
| German and CJK preferences         | German and Simplified Chinese preferences were displayed and captured; the language selector and settings controls remained usable. This is a focused layout check, not full visual review of every language.             |
| Default autostash                  | The preference was enabled by default in the native preview. Checkout/restoration behavior remains documented under the earlier native flows and current engine tests.                                                    |
| Terminal continuity                | A variable set in the live PTY session retained its value after switching the interface language.                                                                                                                         |
| Actual Quit and relaunch           | Process exit was confirmed, then the native preview was relaunched. German remained selected; the demo reopened with the same three changed files.                                                                        |
| Production-bundle startup          | The final cache-built bundle rendered successfully and retained Italian, the open-repository list, the 16 px font setting and enabled autostash. No Git actions or repository mutations were performed during this check. |
| Production German layout and menus | Switching to German updated native menus immediately. The context-menu history hint stayed on one line, and action labels wrapped correctly at 16 px. Italian was restored before quitting.                               |

The packaged native PTY probe also passed. The bundle was then installed in the local Applications folder with the previous app retained in a backup; strict signature and ASAR checks passed after copying, and the installed app rendered with the existing profile. Production startup and layout checks do not establish Developer ID signing, notarization or Gatekeeper acceptance of a downloaded copy.

Screenshots use synthetic demo or public hosting data. `workspace.jpg`, `ai-settings.jpg`, `preferences-de.jpg` and `preferences-zh.jpg` were captured in the 0.4.0 native preview. `diff.jpg`, `hosting-settings.jpg` and `hosting-integration.jpg` retain 0.3.0 evidence; the hosting images show public GitLab data. Each image illustrates the version in which it was captured.

## Build and CI

The original 0.3.0 build produced a macOS arm64 bundle but skipped final signing. A browser-downloaded copy was subsequently rejected as “damaged”; strict verification identified incomplete linker signatures. The 0.3.0 release now carries a download notice. Its ZIP checksum and local launch were not proof of downloaded-app trust.

The 0.4.0 local `npm run package` process builds outside synchronized source folders, removes only generated FinderInfo/ResourceFork metadata before signing, enables hardened runtime and creates a complete ad-hoc signature. `codesign --verify --deep --strict` and the package integrity checks pass. Gatekeeper assessment rejects that ad-hoc build; these local package results do not establish distribution trust.

A separate real 0.4.0 arm64 build was signed with an installed **Developer ID Application** identity. Strict deep signature verification, Apple certificate-chain and Team ID requirements, hardened runtime, secure timestamp, package integrity and the bundled native PTY probe all passed. These are real signing/build results, separate from the release-pipeline simulations above.

The full real `npm run release:macos` workflow completed with exit code 0 on **2 October 2026**. Apple returned `Accepted` for submission `6b781750-dc8a-4c8f-bfad-c19bd70504b6`. Ticket stapling and validation, post-stapling integrity and signature checks, and Gatekeeper assessment all passed. The final `Branchline-0.4.0-mac-arm64.zip` and SHA-256 file were created only after these gates succeeded. Before notarization, the signed bundle had been rejected with `source=Unnotarized Developer ID`; that earlier assessment is separate from the successful final-bundle result.

The published ZIP was downloaded over anonymous HTTPS with `curl`. Its SHA-256 matched the published checksum, `3c6fb95dbdac11d446a237dc59d4a74cee0ab8a80e7e2ce3bd9d5131daacfdf3`. The extracted app passed `codesign --verify --deep --strict`, the Apple Developer ID/Team requirement, `stapler validate` and `spctl` assessment.

For a controlled download-opening test, a `com.apple.quarantine` mark named `BranchlineReleaseQA` was explicitly applied to that app. Quarantine was not stripped; repeated signature and Gatekeeper checks passed. Launching it triggered App Translocation and macOS's standard confirmation reporting Apple's malware check. Choosing **Open** successfully rendered the actual downloaded app in Italian with the existing profile, open repositories and working-tree count preserved. The [OS confirmation screenshot](screenshots/macos-notarized-open.jpg) shows this controlled quarantine test.

The downloaded app was then installed in the local Applications folder with `ditto --qtn`, preserving quarantine and retaining the previous ad-hoc app in a recoverable backup. Strict signature verification, ticket validation and Gatekeeper assessment passed after copying and after the final rename. Native launch of the installed app used App Translocation and rendered the Italian interface with the same three open repositories, 11 displayed working-tree changes, no staged files and a blank commit message.

The in-app browser did not complete the file download, so a normal browser download and browser-added quarantine remain **unverified**. The completed proof covers public HTTPS retrieval, checksum/integrity, an explicitly applied quarantine mark and normal macOS Open/startup. See [macOS distribution](MACOS.md) for the release gates.

The archived 0.3.0 GitHub CI run completed locked installation, its 98 isolated tests and the renderer build in all four Ubuntu/macOS × Node 22/24 combinations. See the [first public CI run](https://github.com/Hexecu/branchline/actions/runs/36933136620) for that source revision. It does not validate the current 0.4.0 localization or release-pipeline additions. Current 0.4.0 automated and native evidence is recorded above; the workflow also runs on subsequent pushes.

The [earlier 0.4.0 source CI run](https://github.com/Hexecu/branchline/actions/runs/36973320230) passed locked installation, all 115 tests and the renderer build in all four combinations at source commit `bf9167c4bbd900a79e96061e25c3207f490945bd`. It predates the additional release regression test and real Developer ID build checks. CI checks source behavior; the current 116-test local run and native package results are recorded separately above.

The [current 0.4.0 source CI run](https://github.com/Hexecu/branchline/actions/runs/36984619561) passed locked installation, all **116 tests** and the renderer build in all four Ubuntu/macOS × Node 22/24 combinations at source commit `d2a055b30913e36d9fef969ffad01658083ae518`. These source checks are separate from Apple notarization and downloaded-app validation.

## External requirements and limits

- OpenAI, Azure, Vertex, Google AI Studio and Bedrock adapters have automated coverage; their accounts were not exercised with real credentials.
- Hosting API access depends on the selected remote, server, profile and permissions. Public GitHub/GitLab were exercised live; enterprise servers, Bitbucket, Azure DevOps, Gitea and Forgejo were not. GitHub CLI is optional for GitHub profiles. A successful repository test does not establish write access or access to every list API.
- Remote Git authentication, signing, Git LFS and remote submodules require their external configuration. Git transport was tested with a local remote.
- AI output needs human review; suggestions do not execute commands or edit files.
- The terminal runs the user's shell and is outside the recovery journal.
- History is bounded; recovery refs are retained and excluded from the visible graph.

See the [feature matrix](FEATURES.md), [guide](GUIDE.md), [hosting profiles](HOSTING.md), [AI settings](AI.md) and [IPC contract](../API.md).
