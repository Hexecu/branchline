# Third-party notices

The current original Branchline source, documentation, translations and assets are licensed under GPL-3.0-only; see [LICENSE](LICENSE) and [COPYRIGHT](COPYRIGHT). Previously published releases, including v0.4.0, retain their MIT license. Dependency licenses remain their own. Dependencies are installed through npm and retain their package license files; source publication does not include node_modules or Electron binaries.

## Direct runtime dependencies

| Package | Version inspected | License |
| --- | --- | --- |
| @aws-sdk/client-bedrock | 3.1145.0 | Apache-2.0 |
| @aws-sdk/client-bedrock-runtime | 3.1145.0 | Apache-2.0 |
| @aws-sdk/credential-providers | 3.1145.0 | Apache-2.0 |
| @xterm/addon-fit | 0.10.0 | MIT |
| @xterm/xterm | 5.5.0 | MIT |
| google-auth-library | 11.1.0 | Apache-2.0 |
| lucide-react | 0.577.0 | ISC |
| node-pty | 1.1.0 | MIT |
| react | 19.3.0 | MIT |
| react-dom | 19.3.0 | MIT |

The locked dependency graph is in [package-lock.json](package-lock.json). AWS SDK and Google Auth dependencies use Apache-2.0; React, terminal packages and node-pty use MIT; Lucide uses ISC. Keep the license and notice files supplied with dependencies when distributing a packaged application.

Electron redistributions also include Electron LICENSE and LICENSES.chromium.html. These notices apply separately to Chromium, Node.js and other bundled components. Developer tooling is installed separately and retains its own license. CSS font names select installed system fonts; no third-party font files are bundled.

[assets/icon.svg](assets/icon.svg) is the original Branchline branch motif. The PNG and ICNS icons use the same original motif. No GitKraken logo or proprietary assets are included.
