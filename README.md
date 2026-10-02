# Branchline

A local-first Git desktop client for macOS. See your commit graph, prepare changes, manage branches, and use a real terminal in one workspace.

Branchline runs Git on your computer. Its demo is a real, isolated repository with branches, merges, tags, stashes, worktrees, and a local remote, so you can try the workflow before opening your own projects.

![Branchline workspace with the commit graph, branches, and staging panel](docs/screenshots/workspace.jpg)

## What you can do

- Explore the commit graph with complete, wrapping reference chips, inspect formatted commit messages, and search by message, author, or SHA.
- Stage files or individual hunks, compare unified and split diffs, and create commits.
- Work with branches, tags, stashes, remotes, worktrees, and Git's merge, rebase, cherry-pick, revert, and reset operations. Double-click a branch to check it out, or open a commit through an explicit detached-HEAD dialog.
- Resolve conflicts in an editable ours/theirs view, including modify/delete conflicts.
- Compare references, inspect file history and blame, plan an interactive rebase, and import or export patches.
- Use guarded undo/redo, recovery copies for discarded changes, autostash enabled by default for checkout/merge/rebase/pull, and an activity log with command output.
- Open a native terminal, switch themes, and browse pull or merge requests through GitHub, GitLab, Bitbucket Cloud/Server, Azure DevOps, Gitea, or Forgejo. Hosting profiles support public services and enterprise servers; issue support depends on the provider.
- Optionally ask an AI model for a commit message or review of a diff. Local models and cloud providers are both configurable; suggestions remain text for you to review.

English is the default interface language. Choose **English, Italiano, Español, Français, Deutsch, Português (Brasil), 日本語, or 简体中文** from **Preferences → Interface language**, the first preference. The language button in the header opens the same selector. Your choice applies immediately and is saved for the next launch.

See the [practical guide](docs/GUIDE.md) for examples using the English interface.

View the native preference screen in [Deutsch](docs/screenshots/preferences-de.jpg) or [简体中文](docs/screenshots/preferences-zh.jpg).

## Build and run from source

You need macOS, Git, Node.js 22.12 or newer, and npm. From the source checkout, install the dependencies and launch the development app:

```sh
npm ci
npm run dev
```

For a production frontend build:

```sh
npm run build
npm start
```

Create a macOS application bundle with:

```sh
npm run package
```

The bundle is written to `~/Library/Caches/Branchline/build/v0.4.0/`, outside synchronized project folders. `npm run package` uses ad-hoc signing for local package integrity. If native dependency compilation fails, install the Xcode Command Line Tools and retry.

The separate `npm run release:macos` workflow uses Developer ID signing and requires Apple notarization, a validated stapled ticket and Gatekeeper assessment before creating its final archive. A real Developer ID build has passed signature and package-integrity checks. **Notarization, a stapled ticket and Gatekeeper acceptance of a downloaded copy remain unverified.** See [macOS distribution](docs/MACOS.md) for the current evidence and interactive Keychain setup.

Open the app and choose **Explore the demo**. The **+** beside the repository tabs and the command palette also let you open the isolated demo. Existing demo changes are preserved when you reopen it.

## Prepare a focused commit

Click a changed file to inspect its diff. Use **Stage hunk** to prepare only that block, or the file's **+** button to stage the whole file. Review the staging list, enter a message, and choose **Create commit**. A commit stays local until you push it.

![Unified file diff and the hunk staging controls](docs/screenshots/diff.jpg)

## Hosting profiles

Open **Integrations** to choose a remote, or **Preferences → Hosting profiles** to configure an account or enterprise server. Profiles cover GitHub, GitLab, Bitbucket Cloud/Server, Azure DevOps, Gitea and Forgejo. Bind a saved profile to each repository/remote pair without changing Git's URL or credentials.

Public access can run without a token. Private access uses encrypted credentials or, for GitHub, the existing GitHub CLI login. Integration lists are read-only; supported issue APIs vary by provider. See the [hosting guide](docs/HOSTING.md) for server URLs, authentication modes and limits.

![Hosting settings with seven provider choices and a successful public GitLab repository test](docs/screenshots/hosting-settings.jpg)

View the [read-only GitLab list](docs/screenshots/hosting-integration.jpg), retrieved for a public remote attached to the isolated demo.

## Optional AI

Configure profiles for **OpenAI, Azure OpenAI, Google AI Studio, Vertex AI, LiteLLM, Amazon Bedrock, Ollama, or an OpenAI-compatible endpoint** such as LM Studio or vLLM. Import `.env` or JSON settings, discover models where supported, or enter an exact model ID manually.

The app shows the selected destination before generation. A cloud profile sends the chosen diff to that provider when you click **Generate suggestion**; a local profile uses its configured local endpoint. Git operations work without AI or a cloud account.

Credentials are encrypted through the operating system and kept separately from profile metadata. Saved secrets are never returned to the interface. See [AI configuration and data handling](docs/AI.md) for authentication, import formats, limits, and test coverage.

![AI settings with provider profiles, model selection, and explicit connection testing](docs/screenshots/ai-settings.jpg)

## Development and verification

```sh
npm test
npm run build
```

Tests use isolated Git fixtures and mocked AI transports. Passing them does not establish access to every real provider. Native desktop checks, external dependencies, and remaining gaps are recorded in [VALIDATION.md](docs/VALIDATION.md).

The renderer uses React and TypeScript. Electron's main process owns Git, filesystem, terminal, and provider access through an isolated IPC bridge. See the [API contract](API.md), [feature scope](docs/FEATURES.md), and [user guide](docs/GUIDE.md).

Current limits include file/hunk staging rather than individual-line staging, a default graph window of 400 commits with reference-focused navigation, and read-only hosting integrations. Remote Git authentication, GPG signing, Git LFS, and AI providers require their own configuration. See [hosting profiles](docs/HOSTING.md) for remote selection, server URLs, and provider capabilities.
