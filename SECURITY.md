# Security policy

Branchline is an experimental desktop application. Security fixes are made on the current development branch; there is no formal support or response-time guarantee for older releases.

## Reporting a vulnerability

Use **Security → Report a vulnerability** on the GitHub repository when private vulnerability reporting is enabled. If that option is unavailable, open a minimal issue requesting a private reporting channel without publishing exploit details or sensitive data. Never include active credentials, private repository contents or personal filesystem paths in a public report.

A useful private report includes the affected revision/version, operating system, a concise impact description and reproduction steps using an isolated repository with synthetic data. Redact credentials from logs, screenshots, diffs and imported configuration files. Disclose publicly after a fix or coordinated agreement.

## Trust boundaries

- The renderer uses Electron context isolation, sandboxing and disabled Node integration. Filesystem, Git, terminal and provider access run in the main process through the IPC bridge. External navigation and new renderer windows are blocked; the frontend applies a Content Security Policy.
- Repository operations require a repository registered through open/init/clone/demo. Relative file access rejects traversal and external symlinks. Git commands use argument arrays rather than shell interpolation.
- Git hooks, repository configuration, installed tools and commands typed into the PTY terminal can execute code with the user's permissions. Treat repositories and external runtimes as trusted before invoking operations that execute them. Undo does not cover arbitrary terminal commands, remote history or every Git operation.
- AI sends the selected diff and request to the configured endpoint. A gateway may forward data elsewhere. The interface shows the destination; suggestions are text for human review and never trigger Git actions. Exact model selection is retained without a substitute-model fallback.
- Remote AI endpoints require HTTPS; HTTP is limited to loopback. Embedded URL credentials and redirects are rejected. Known credentials are redacted from provider errors/results. This is not a general secret detector for repository diffs: review the diff before sending it.
- Hosting adapters read repository metadata and supported PR/issue lists. Profile host, HTTPS port, server prefix and Azure organization/collection must match the selected remote before sending credentials. Redirects and pagination to another origin or endpoint are rejected. Remote URLs are not used as a source of API credentials. Public access and GitHub CLI mode have their own permission boundaries; hosting profiles do not replace Git authentication.
- Commit messages render a Markdown subset through React without raw HTML or image loading. Links must be HTTPS without embedded credentials and are opened through the main process. Large messages fall back to original text.

## Credential storage

AI metadata is stored in the application's `ai/profiles.json`; hosting metadata and remote bindings use `hosting/profiles.json`. Credentials are stored as encrypted base64 ciphertext in the corresponding `ai/credentials.json` or `hosting/credentials.json`, using Electron `safeStorage` in the main process. On macOS, the encryption key is protected by Keychain. Vault writes use atomic replacement, a 0700 directory and a 0600 file.

Unavailable encryption and the Linux `basic_text` backend are rejected; there is no plaintext fallback. Read APIs expose a credential-presence flag without returning saved credential values. Configuration imports read the selected local file without executing environment expressions or changing the source file. The file's original contents remain the user's responsibility. [Electron safeStorage documentation](https://www.electronjs.org/docs/latest/api/safe-storage).

The local macOS bundle is not signed/notarized for distribution. A changing application signature can cause Keychain access prompts on updates. Account credentials, ADC and AWS profiles used by external SDKs remain subject to their own configuration and permission rules.

## Testing and audit scope

Automated Git tests use isolated temporary repositories. AI/hosting tests use synthetic credentials and mock HTTP/SDK/CLI transports; vault tests use a mock safeStorage provider. See [validation results](docs/VALIDATION.md), [AI configuration](docs/AI.md) and [hosting configuration](docs/HOSTING.md) for the distinction between automated, native and live-provider observations.

The source-publication audit inspected project text files, original assets and locally installed dependency license metadata. It did not inspect personal environment files, credentials, private repositories or remote accounts. A pattern scan is not a guarantee that every sensitive value or vulnerability has been detected.
