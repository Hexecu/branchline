# Contributing to Branchline

Branchline is a visual Git desktop client built with Electron, React and TypeScript. Contributions should preserve the boundary between the renderer, the main process and the system Git executable.

## Local development

Use Node.js 22.12 or later, npm and Git. Node.js 22 and 24 are covered by the CI matrix on Ubuntu and macOS. Building the native terminal dependency may require a C/C++ toolchain and Python; on macOS, install Xcode Command Line Tools.

```sh
npm ci
npm test
npm run build
npm run dev
```

`npm run dev` opens the desktop app. Use **Explore the demo** or a temporary repository for manual testing. The app uses real Git commands: never use personal or production repositories as test fixtures. The supported packaging target is currently macOS; CI tests the backend and builds the renderer, without claiming desktop UI or packaging coverage on Linux.

## Changes and validation

- Keep Git operations in the main process and use argument arrays, without shell interpolation. Validate file containment and Git references before performing operations.
- Preserve recoverable changes when adding destructive Git actions. Include an isolated integration test for behavior that affects repository data.
- Keep AI credentials in the encrypted vault. Profile metadata, renderer responses, errors and logs must not contain secrets. Model discovery is not proof that inference is available; verify the exact requested model without silently substituting another one.
- Test AI adapters with mocked HTTP or injected SDKs. CI must not require cloud credentials, real provider calls, paid inference, a running Ollama server, or access to private repositories.
- Check desktop behavior manually for UI changes and state which flows were actually exercised. A renderer build does not verify the native app.

Run `npm test` and `npm run build` before submitting a change. Format edited source with the existing Prettier configuration. Describe the problem, resulting behavior, validation and any remaining limitation in the pull request.

## Example AI configurations

The files under `examples/` contain synthetic profiles and placeholder credentials only. Copy an example to a private location outside the repository, replace its placeholders, and import that copy through the native file picker in **Configure AI**. Do not commit the private copy.

`examples/ai-profiles.example.json` imports local Ollama, a local OpenAI-compatible endpoint, and a Vertex profile that uses your separately configured Application Default Credentials. `examples/.env.example` documents the recognized environment-variable names. The **Import from harness** action asks you to select a configuration file explicitly; it uses a LiteLLM profile from that file and retains the exact `gemini-3.5-flash` model selection.

The importer reads environment files as data and does not execute shell commands or expand shell variables. A `GOOGLE_APPLICATION_CREDENTIALS` value references a local service-account JSON file relative to the selected environment file, so review that path before importing.

## Reporting issues

Include the operating system, app version, Git version, expected result, observed result and a reproduction in a temporary repository. Redact tokens, private URLs, repository contents and personal paths from logs and screenshots. Do not post credentials or private repository exports in issues or pull requests.
