# Desktop platforms

Branchline 0.4.1 has native build and desktop verification lanes for the following targets. A configured lane is a reproducible check, not evidence of success until its run and reports pass.

| OS and CPU                 | Native CI host     | Package and runtime checks                                               |
| -------------------------- | ------------------ | ------------------------------------------------------------------------ |
| macOS, Intel x64           | `macos-15-intel`   | Ad-hoc signed app, Mach-O architecture, native PTY, renderer and Git IPC |
| macOS, Apple Silicon arm64 | `macos-15`         | Ad-hoc signed app, Mach-O architecture, native PTY, renderer and Git IPC |
| Linux glibc, x64           | `ubuntu-24.04`     | ELF architecture, rebuilt native PTY, Xvfb renderer and Git IPC          |
| Linux glibc, arm64         | `ubuntu-24.04-arm` | ELF architecture, rebuilt native PTY, Xvfb renderer and Git IPC          |
| Windows, x64               | `windows-2025`     | PE architecture, native ConPTY, renderer and Git IPC                     |
| Windows, arm64             | `windows-11-arm`   | PE architecture, native ConPTY, renderer and Git IPC                     |

Electron 44 requires macOS 13 or newer; CI runs on macOS 15. Linux verification covers Ubuntu 24.04 with glibc, X11/Xvfb and the GTK/NSS/audio libraries installed by CI. It does not establish compatibility with musl/Alpine, every Linux distribution, GPU, Wayland configuration or older OS. Windows checks use the named current Windows runners and ConPTY. No 32-bit, BSD, mobile or universal macOS package is claimed.

`npm test` uses isolated Git fixtures and mocked provider/vault transports. `npm run package` builds for the current host architecture, compares the packaged application source byte for byte, validates GPL and reviewed Electron/Chromium notices and executable architecture, then executes the packaged Electron/native PTY. `npm run test:desktop` starts that exact package with fresh temporary user data and a real Git repository. It verifies renderer startup, preload IPC, graph display, diff, staging, commit, shell input/resize/exit, keyboard hints, architecture, enabled renderer sandbox/context isolation and clean app shutdown. It never imports credentials or calls native encryption/decryption. Linux CI sets root ownership and mode 4755 only on the generated temporary package's `chrome-sandbox` helper; it does not change global kernel or OS security settings.

The separate Linux and Windows storage checks use real OS encryption with randomly generated synthetic credentials. Linux owns a disposable D-Bus session and a fresh unlocked GNOME keyring; Windows uses DPAPI. They verify native async availability, encryption/decryption across process restart, compatibility with encrypted v1 data produced by Electron's earlier synchronous API, rejection of corrupt ciphertext, redacted errors, deletion and the absence of plaintext credentials on disk. Storage reports explicitly exclude renderer sandbox acceptance: that is verified by the desktop check. macOS native credential acceptance is excluded from CI to avoid requesting access to a real login keychain. The vault never falls back to plaintext and bounds pending native operations.

The native desktop lanes upload JSON verification reports only. They do not publish applications or replace signed/notarized releases. A macOS local CI app is ad-hoc signed; Windows/Linux local packages have no publisher trust claim. Installer download, first-run trust dialogs, real hosting/LLM access, macOS keychain access and user-specific Git/SSH/GPG configuration require their own acceptance checks. The historical published MIT macOS arm64 `v0.4.0` remains unchanged.

## Local builds

Install Git and Node.js 22.12 or newer, then run `npm ci`, `npm test` and `npm run package`. macOS needs Xcode Command Line Tools. Linux needs Python, make and a C/C++ compiler for `node-pty`, plus desktop libraries; Windows needs the supported native prebuild or the Visual Studio C++ toolchain if rebuilding. The lockfile keeps the dependency versions consistent.

Set `BRANCHLINE_PACKAGE_OUTPUT` to a dedicated directory outside synchronized folders to choose the package destination. The default is the OS temporary directory under `Branchline/build/vVERSION-PLATFORM-ARCH`. Keep the environment variable set when running `npm run test:desktop`; it reads the generated `desktop-verification.json` to locate the exact app. `npm run package:macos` retains the macOS-only cache path and signing workflow described in [MACOS.md](MACOS.md).

The app preserves Windows PATH separators and launches `COMSPEC`/`cmd.exe`; Unix uses the configured existing shell, then the OS-appropriate shell fallback. Linux and Windows use native window controls and Ctrl shortcuts. macOS retains its inset window controls and Command shortcuts. Git for Windows invokes interactive editors through its POSIX shell, so generated executable/script paths are normalized without removing argument quoting.
