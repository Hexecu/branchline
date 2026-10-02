"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const asar = require("@electron/asar");

function verifyPackage(bundlePath, { probeNative = false } = {}) {
  if (process.platform !== "darwin")
    throw new Error("macOS package verification requires macOS codesign.");
  const app = path.resolve(bundlePath);
  if (!app.endsWith(".app") || !fs.statSync(app).isDirectory())
    throw new Error("Expected a completed .app bundle.");
  execFileSync(
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", "--verbose=2", app],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const contents = path.join(app, "Contents");
  if (
    !fs
      .statSync(path.join(contents, "_CodeSignature", "CodeResources"))
      .isFile()
  )
    throw new Error("The app bundle has no sealed code resources.");
  const plist = JSON.parse(
    execFileSync(
      "/usr/bin/plutil",
      ["-convert", "json", "-o", "-", path.join(contents, "Info.plist")],
      { encoding: "utf8" },
    ),
  );
  if (plist.CFBundleIdentifier !== "local.branchline.desktop")
    throw new Error("Unexpected application bundle identifier.");
  const archive = path.join(contents, "Resources", "app.asar");
  const { headerString } = asar.getRawHeader(archive);
  const integrity = plist.ElectronAsarIntegrity?.["Resources/app.asar"];
  const hash = crypto.createHash("sha256").update(headerString).digest("hex");
  if (integrity?.algorithm !== "SHA256" || integrity.hash !== hash)
    throw new Error(
      "The sealed ASAR header integrity does not match Info.plist.",
    );
  const packageData = JSON.parse(
    asar.extractFile(archive, "package.json").toString("utf8"),
  );
  if (packageData.version !== plist.CFBundleShortVersionString)
    throw new Error("Application and package versions do not match.");
  for (const entry of [
    "electron/main.cjs",
    "electron/preload.cjs",
    "locales/runtime.mjs",
    "locales/languages.json",
    "locales/core.json",
    "locales/settings.json",
    "locales/git-tools.json",
    "locales/actions.json",
    "locales/extra.json",
  ]) {
    if (!asar.extractFile(archive, entry).length)
      throw new Error(`Missing required package entry: ${entry}`);
  }
  const ptyRoot = path.join(
    contents,
    "Resources",
    "app.asar.unpacked",
    "node_modules",
    "node-pty",
  );
  const ptyBinaries = [
    path.join(ptyRoot, "prebuilds", `darwin-${process.arch}`, "pty.node"),
    path.join(ptyRoot, "build", "Release", "pty.node"),
  ];
  if (!ptyBinaries.some((filename) => fs.existsSync(filename)))
    throw new Error(
      "The package is missing a native PTY binary for the current architecture.",
    );
  // Static checks never execute an arbitrary app supplied to this verifier.
  const nativeArch = process.arch === "x64" ? "x86_64" : process.arch;
  const hasNativePair = ptyBinaries.some((binary) => {
    try {
      const helper = path.join(path.dirname(binary), "spawn-helper");
      fs.accessSync(helper, fs.constants.X_OK);
      for (const filename of [binary, helper])
        execFileSync("/usr/bin/lipo", [filename, "-verify_arch", nativeArch], {
          stdio: ["ignore", "pipe", "pipe"],
        });
      return true;
    } catch {
      return false;
    }
  });
  if (!hasNativePair)
    throw new Error(
      "No matching native PTY binary and executable helper were found.",
    );
  // Only the build pipeline opts in for the app it has just generated.
  if (probeNative) {
    const ptyProbe = `
      const pty = require(${JSON.stringify(path.join(archive, "node_modules/node-pty"))});
      const modulePath = Object.keys(require.cache).find(name => /[\\/]pty\\.node$/.test(name));
      let output = '';
      const terminal = pty.spawn('/bin/sh', ['-c', 'printf branchline-pty-ok'], {
        cwd: require('node:os').tmpdir(), env: process.env, cols: 80, rows: 24
      });
      const timer = setTimeout(() => { terminal.kill(); process.exit(2); }, 5000);
      terminal.onData(data => { output += data; });
      terminal.onExit(({exitCode}) => {
        clearTimeout(timer);
        if (exitCode !== 0 || !output.includes('branchline-pty-ok')) process.exit(3);
        console.log(JSON.stringify({modulePath}));
      });
    `;
    const probeResult = JSON.parse(
      execFileSync(
        path.join(contents, "MacOS", plist.CFBundleExecutable),
        ["-e", ptyProbe],
        {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
          encoding: "utf8",
          timeout: 10000,
        },
      ),
    );
    const loadedBinary = probeResult.modulePath?.replace(
      "app.asar/",
      "app.asar.unpacked/",
    );
    if (!loadedBinary || !loadedBinary.startsWith(ptyRoot + path.sep))
      throw new Error("The native PTY probe loaded an unexpected module.");
    const helper = path.join(path.dirname(loadedBinary), "spawn-helper");
    fs.accessSync(helper, fs.constants.X_OK);
    for (const filename of [loadedBinary, helper])
      execFileSync(
        "/usr/bin/lipo",
        [
          filename,
          "-verify_arch",
          process.arch === "x64" ? "x86_64" : process.arch,
        ],
        {
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
  }
  const result = {
    app,
    version: packageData.version,
    signatureIntegrity: true,
    asarIntegrity: true,
    nativePtyVerified: probeNative,
    notarizationVerified: false,
  };
  return result;
}

if (require.main === module) {
  const app =
    process.argv[2] ||
    path.join(
      os.homedir(),
      "Library",
      "Caches",
      "Branchline",
      "build",
      `v${require("../package.json").version}`,
      process.arch === "x64" ? "mac" : `mac-${process.arch}`,
      "Branchline.app",
    );
  try {
    const result = verifyPackage(app);
    console.log(
      `Verified Branchline ${result.version}: complete code signature, sealed resources, ASAR integrity and required runtime files.`,
    );
    console.log(
      "Signature integrity does not establish Developer ID trust or Apple notarization.",
    );
  } catch (error) {
    console.error("Package verification failed:", error.message);
    process.exitCode = 1;
  }
}

module.exports = { verifyPackage };
