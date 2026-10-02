"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { verifyPackage } = require("./verify-package.cjs");

const root = path.resolve(__dirname, "..");
const version = require(path.join(root, "package.json")).version;

function packageMac({
  identity,
  outputDir,
  buildRenderer = true,
  env = process.env,
  run = execFileSync,
  log = console.log,
} = {}) {
  if (process.platform !== "darwin")
    throw new Error("macOS packaging requires macOS.");
  // File Provider can add Finder metadata back to bundles in Documents while
  // codesign is running. Keep generated apps outside a synchronized checkout.
  const output = path.resolve(
    outputDir ||
      path.join(
        os.homedir(),
        "Library",
        "Caches",
        "Branchline",
        "build",
        `v${version}`,
      ),
  );
  fs.mkdirSync(output, { recursive: true });
  if (buildRenderer)
    run("npm", ["run", "build"], { cwd: root, env, stdio: "inherit" });
  const args = [
    require.resolve("electron-builder/out/cli/cli.js"),
    "--mac",
    "dir",
    "--publish",
    "never",
    `--config.directories.output=${output}`,
  ];
  if (identity) args.push(`--config.mac.identity=${identity}`);
  if (identity && identity !== "-")
    args.push(
      "--config.forceCodeSigning=true",
      "--config.mac.type=distribution",
      "--config.mac.hardenedRuntime=true",
      "--config.mac.notarize=false",
    );
  run(process.execPath, args, { cwd: root, env, stdio: "inherit" });
  const bundle = path.join(
    output,
    process.arch === "x64" ? "mac" : `mac-${process.arch}`,
    "Branchline.app",
  );
  const verification = verifyPackage(bundle, { probeNative: true });
  log(`Verified Branchline ${version}: ${bundle}`);
  return { bundle, output, verification };
}

if (require.main === module) {
  try {
    packageMac();
    console.log(
      "Local signature integrity is verified; Developer ID trust and notarization are separate release checks.",
    );
  } catch (error) {
    console.error("Package failed:", error.message);
    process.exitCode = 1;
  }
}

module.exports = { packageMac };
