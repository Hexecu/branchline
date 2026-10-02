# macOS distribution

New macOS packages are configured to use a complete **ad-hoc signature**. This seals the bundle and its nested code so macOS can verify that the package has not changed. It is not an Apple Developer ID signature and is not notarized. A successful signature check does not mean Gatekeeper trusts the publisher.

Build with `npm run package`. Generated bundles go to `~/Library/Caches/Branchline/build/<version>/`, outside synchronized source folders. The build removes only FinderInfo and ResourceFork metadata from its generated bundle before signing; quarantine attributes are retained. The package verification script checks the finished `.app` with `codesign --verify --deep --strict`, sealed code resources, ASAR header integrity, version agreement, required locale files and matching native PTY/helper binaries. The build also runs a synthetic PTY probe in its newly generated bundle. The standalone verifier is passive and never executes an app supplied by the user. Verification must finish before creating or publishing an archive. Use `node scripts/verify-package.cjs /absolute/path/Branchline.app` to repeat it.

The hardened runtime stays enabled. The [entitlements](../assets/entitlements.mac.plist) allow Electron's JIT engine and the library loading needed for ad-hoc signing. They do not request camera, microphone or location access. Files in a signed bundle must not be changed afterward.

The original 0.3.0 package skipped final signing and retained incomplete linker signatures. Its local launch did not exercise the browser-download Gatekeeper boundary; the reported “damaged” message was consistent with the failed bundle signature check. New package integrity and native launch results belong in [VALIDATION.md](VALIDATION.md).

For distribution under default Gatekeeper policy, the release needs a valid **Developer ID Application** certificate, hardened-runtime signing, Apple notarization and a stapled ticket. Those credentials and that release process are separate from ad-hoc development builds. Do not treat archive checksums or a local launch as notarization proof. Follow [Apple's safe-opening guidance](https://support.apple.com/en-au/102445) when macOS blocks a download; this project does not disable Gatekeeper or remove quarantine attributes.

References: [electron-builder v26 macOS signing](https://www.electron.build/v26/docs/features/code-signing/code-signing-mac/), [Electron code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing), [Apple distribution signing](https://developer.apple.com/documentation/xcode/creating-distribution-signed-code-for-the-mac/).

## Prepare an Apple Developer release

Install a **Developer ID Application** certificate and its private key in the macOS Keychain. A free developer account or an Apple Development certificate is not a distribution identity. Apple documents the [Developer ID certificate process](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/). Keep private keys, certificate passwords and Apple credentials out of this repository and chat.

Save your notarization credentials yourself using the interactive Keychain flow:

```sh
xcrun notarytool store-credentials branchline-notary
```

Then use the exact installed certificate name and the existing Keychain profile name. These two names are not passwords:

```sh
export BRANCHLINE_SIGN_IDENTITY='Developer ID Application: Your Name (TEAMID1234)'
export BRANCHLINE_NOTARY_PROFILE='branchline-notary'
npm run release:macos -- --check
npm run release:macos
```

The first command performs an offline certificate preflight. It does not prove the Keychain profile can authenticate with Apple. The release command signs the generated app, submits it to Apple, requires an `Accepted` result, staples and validates the ticket, rechecks integrity and requires a successful Gatekeeper assessment. Only then does it create the final ZIP and checksum under `~/Library/Caches/Branchline/releases/<version>/`. It never publishes to GitHub automatically. Failed notarization, stapling or Gatekeeper checks leave no final release ZIP.

The release pipeline's error gates have simulated regression coverage. A trusted release still requires a successful real run with the owner's configured Apple identity; simulated tests and local ad-hoc builds do not satisfy that requirement.
