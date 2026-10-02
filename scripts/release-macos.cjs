"use strict";

// Run only after the owner has installed an Apple Developer ID Application
// identity and saved notarytool credentials in a Keychain profile. This script
// never creates/imports certificates or accepts passwords/private keys.
//
// BRANCHLINE_SIGN_IDENTITY='Developer ID Application: Your Name (TEAMID1234)'
// BRANCHLINE_NOTARY_PROFILE='your-existing-keychain-profile'
// node scripts/release-macos.cjs --check  # local, offline preflight only
// node scripts/release-macos.cjs          # signs and submits to Apple

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { packageMac } = require("./package-macos.cjs");
const { verifyPackage } = require("./verify-package.cjs");

const root = path.resolve(__dirname, "..");
const packageData = require(path.join(root, "package.json"));
const PEM = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;
const APPLE_REQUIREMENT =
  "anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.13] exists";
const CREDENTIAL_ENV =
  /(?:token|password|secret|(?:^|_)key(?:_|$)|credential|csc_link)/i;

function configuration(env, platform = process.platform, arch = process.arch) {
  if (platform !== "darwin") throw new Error("This release requires macOS.");
  if (!["arm64", "x64"].includes(arch))
    throw new Error("Supported release architectures are arm64 and x64.");
  const identity = String(env.BRANCHLINE_SIGN_IDENTITY || "").trim();
  const profile = String(env.BRANCHLINE_NOTARY_PROFILE || "").trim();
  if (!identity || !profile)
    throw new Error(
      "Set BRANCHLINE_SIGN_IDENTITY and BRANCHLINE_NOTARY_PROFILE to existing identity/profile names. No signing or submission has started.",
    );
  const match = identity.match(
    /^Developer ID Application: [^\r\n\x00-\x1f]+ \(([A-Z0-9]{10})\)$/,
  );
  if (!match || identity.length > 500)
    throw new Error(
      "BRANCHLINE_SIGN_IDENTITY must be the full, exact Developer ID Application certificate name, including its Team ID. Ad-hoc and self-signed identities are not supported.",
    );
  if (
    profile.length > 200 ||
    profile.startsWith("-") ||
    /[\x00-\x1f\x7f]/.test(profile)
  )
    throw new Error("BRANCHLINE_NOTARY_PROFILE is not a valid profile name.");
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(packageData.version))
    throw new Error("The source package has an invalid release version.");
  return {
    identity,
    profile,
    teamId: match[1],
    arch,
    version: packageData.version,
  };
}

function sanitizer(env = process.env) {
  const secrets = Object.entries(env)
    .filter(([key, value]) => value && CREDENTIAL_ENV.test(key))
    .map(([, value]) => String(value))
    .sort((a, b) => b.length - a.length);
  return (input) => {
    let text = String(input || "");
    for (const secret of secrets) text = text.split(secret).join("[redacted]");
    return text
      .replace(
        /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
        "[redacted private key]",
      )
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/=_\-.]+/gi, "$1 [redacted]")
      .replace(
        /(["']?(?:password|token|secret|api[_-]?key|access[_-]?key(?:[_-]?id)?|session[_-]?token|credential|signature)["']?\s*[=:]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;]+)/gi,
        "$1[redacted]",
      )
      .replace(/(https?:\/\/)[^\s/@]+@/gi, "$1[redacted]@")
      .replace(/(https?:\/\/[^\s?#]+)\?[^\s#]*/gi, "$1?[redacted]")
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
      .slice(-4096);
  };
}

function buildEnvironment(env) {
  const clean = { ...env };
  // Only the installed certificate selected below may sign. In particular,
  // electron-builder must not download/import CSC_LINK or auto-notarize using
  // unrelated Apple credentials inherited from another project.
  for (const key of Object.keys(clean))
    if (
      CREDENTIAL_ENV.test(key) ||
      /^(?:CSC_|APPLE_|BRANCHLINE_(?:SIGN_IDENTITY|NOTARY_PROFILE)$)/.test(key)
    )
      delete clean[key];
  clean.CSC_IDENTITY_AUTO_DISCOVERY = "false";
  delete clean.DEBUG;
  delete clean.ELECTRON_BUILDER_ALLOW_UNRESOLVED_DEPENDENCIES;
  return clean;
}

function runner(env, sanitize) {
  return (label, executable, args, options = {}) => {
    const result = spawnSync(executable, args, {
      cwd: root,
      env,
      ...options,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 4 * 1024 * 1024,
      timeout: options.timeout || 120000,
    });
    if (result.error || result.status !== 0) {
      const detail = sanitize(
        [result.error?.message, result.stderr, result.stdout]
          .filter(Boolean)
          .join("\n"),
      );
      throw new Error(
        `${label} failed (${result.signal || result.status || "process error"}).${detail ? "\n" + detail : ""}`,
      );
    }
    return { stdout: result.stdout || "", stderr: result.stderr || "" };
  };
}

function installedIdentity(output, expectedName) {
  const hashes = new Set();
  for (const line of output.split("\n")) {
    const match = line.match(/^\s*\d+\)\s+([A-Fa-f0-9]{40})\s+"(.+)"\s*$/);
    if (match && match[2] === expectedName) hashes.add(match[1].toUpperCase());
  }
  if (hashes.size !== 1)
    throw new Error(
      "The exact Developer ID Application identity is missing or ambiguous in the current codesigning Keychain search list.",
    );
  return [...hashes][0];
}

function certificatePreflight(run, config, hash, scratch) {
  const exported = run("Read public signing certificate", "/usr/bin/security", [
    "find-certificate",
    "-a",
    "-c",
    config.identity,
    "-p",
  ]).stdout;
  const selected = (exported.match(PEM) || []).find(
    (pem) =>
      new crypto.X509Certificate(pem).fingerprint.replaceAll(":", "") === hash,
  );
  if (!selected)
    throw new Error(
      "The selected identity's public certificate was not found.",
    );
  const certificate = new crypto.X509Certificate(selected);
  if (
    !/^CN=Developer ID Certification Authority(?: G\d+)?$/m.test(
      certificate.issuer,
    ) ||
    !certificate.subject.split("\n").includes(`OU=${config.teamId}`)
  )
    throw new Error(
      "The selected certificate is not an Apple-issued Developer ID Application identity.",
    );
  const leaf = path.join(scratch, "developer-id-public.pem");
  fs.writeFileSync(leaf, selected, { mode: 0o600 });
  const systemRoots = run("Read public Apple roots", "/usr/bin/security", [
    "find-certificate",
    "-a",
    "-p",
    "/System/Library/Keychains/SystemRootCertificates.keychain",
  ]).stdout;
  const roots = (systemRoots.match(PEM) || []).filter((pem) =>
    /^CN=Apple Root CA(?: - G\d+)?$/m.test(
      new crypto.X509Certificate(pem).subject,
    ),
  );
  if (!roots.length)
    throw new Error(
      "No Apple root certificate is present in the system root Keychain.",
    );
  const args = [
    "verify-cert",
    "-c",
    leaf,
    "-p",
    "codeSign",
    "-L",
    "-R",
    "offline",
  ];
  roots.forEach((pem, index) => {
    const file = path.join(scratch, `apple-root-public-${index}.pem`);
    fs.writeFileSync(file, pem, { mode: 0o600 });
    args.push("-r", file);
  });
  run("Verify Apple certificate trust offline", "/usr/bin/security", args);
}

function signedIdentity(output, config) {
  const lines = output.split("\n");
  // codesign prints "CodeDirectory v=...", not a key/value "CodeDirectory=".
  // Require both the actual flag bit and its exact decoded name in that field.
  const directory = lines
    .map((line) =>
      /^CodeDirectory v=[\da-f]+ size=\d+ flags=0x([\da-f]{1,8})\(([a-z0-9_-]+(?:,[a-z0-9_-]+)*)\)(?: [^\r\n]+)?$/i.exec(
        line,
      ),
    )
    .filter(Boolean);
  const hardenedRuntime =
    directory.length === 1 &&
    (BigInt(`0x${directory[0][1]}`) & 0x10000n) !== 0n &&
    directory[0][2].split(",").includes("runtime");
  if (
    !lines.includes(`Authority=${config.identity}`) ||
    !lines.includes(`TeamIdentifier=${config.teamId}`) ||
    !hardenedRuntime ||
    !/^Timestamp=.+/m.test(output)
  )
    throw new Error(
      "The app does not have the requested Developer ID identity, Team ID, hardened runtime and secure timestamp.",
    );
}

function fileHash(filename) {
  const hash = crypto.createHash("sha256"),
    buffer = Buffer.alloc(64 * 1024);
  const descriptor = fs.openSync(filename, "r");
  try {
    let length;
    while ((length = fs.readSync(descriptor, buffer, 0, buffer.length, null)))
      hash.update(buffer.subarray(0, length));
    return hash.digest("hex");
  } finally {
    fs.closeSync(descriptor);
  }
}

function releaseMac({ env = process.env, checkOnly = false } = {}) {
  const config = configuration(env),
    sanitize = sanitizer(env);
  const safeEnv = buildEnvironment(env),
    run = runner(safeEnv, sanitize);
  const cache = path.join(os.homedir(), "Library", "Caches", "Branchline");
  fs.mkdirSync(cache, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(cache, ".release-check-"));
  let lock, lockPath, temporary;
  try {
    console.log(
      "Checking existing Developer ID identity and local release tools…",
    );
    run("Locate notarytool", "/usr/bin/xcrun", ["--find", "notarytool"]);
    run("Locate stapler", "/usr/bin/xcrun", ["--find", "stapler"]);
    const hash = installedIdentity(
      run("Find installed signing identity", "/usr/bin/security", [
        "find-identity",
        "-v",
        "-p",
        "codesigning",
      ]).stdout,
      config.identity,
    );
    certificatePreflight(run, config, hash, scratch);
    if (checkOnly) {
      console.log(
        "Offline preflight passed. Keychain profile authentication is checked only during submission.",
      );
      return { preflight: true };
    }
    const output = path.join(cache, "releases", `v${config.version}`);
    fs.mkdirSync(output, { recursive: true });
    lockPath = path.join(output, `.mac-${config.arch}.lock`);
    lock = fs.openSync(lockPath, "wx", 0o600);
    fs.writeFileSync(
      lock,
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );
    const name = `Branchline-${config.version}-mac-${config.arch}.zip`;
    const zip = path.join(output, name),
      checksum = zip + ".sha256";
    if (fs.existsSync(zip) || fs.existsSync(checksum))
      throw new Error(
        "Release artifacts already exist for this version/architecture. Review them before replacing them.",
      );
    temporary = fs.mkdtempSync(path.join(output, ".notary-"));
    const buildRoot = path.join(cache, "build");
    fs.mkdirSync(buildRoot, { recursive: true });
    const buildOutput = fs.mkdtempSync(
      path.join(buildRoot, `signed-v${config.version}-`),
    );
    console.log("Building and signing outside the synchronized checkout…");
    const { bundle } = packageMac({
      identity: hash,
      outputDir: buildOutput,
      env: safeEnv,
      run: (file, args, options) =>
        run("Build signed package", file, args, {
          ...options,
          timeout: 1200000,
        }).stdout,
      log: () => {},
    });
    const details = run("Inspect Developer ID signature", "/usr/bin/codesign", [
      "-d",
      "--verbose=4",
      bundle,
    ]);
    signedIdentity(details.stdout + "\n" + details.stderr, config);
    // codesign interprets -R as a filename unless the literal starts with '='.
    const requirement = `=${APPLE_REQUIREMENT} and certificate leaf[subject.OU] = "${config.teamId}"`;
    run("Verify Apple Developer ID requirement", "/usr/bin/codesign", [
      "--verify",
      "--deep",
      "--strict",
      "-R",
      requirement,
      bundle,
    ]);
    const submissionZip = path.join(temporary, "submission.zip");
    run(
      "Create notarization archive",
      "/usr/bin/ditto",
      ["-c", "-k", "--sequesterRsrc", "--keepParent", bundle, submissionZip],
      { timeout: 600000 },
    );
    console.log(
      "Submitting to Apple using the existing Keychain profile; waiting for acceptance…",
    );
    const submission = run(
      "Apple notarization",
      "/usr/bin/xcrun",
      [
        "notarytool",
        "submit",
        submissionZip,
        "--keychain-profile",
        config.profile,
        "--wait",
        "--timeout",
        "45m",
        "--output-format",
        "json",
      ],
      { timeout: 3000000 },
    );
    let result;
    try {
      result = JSON.parse(submission.stdout);
    } catch {
      throw new Error(
        "notarytool did not return a valid JSON submission result.",
      );
    }
    if (result.status !== "Accepted") {
      const status = /^[A-Za-z ]{1,50}$/.test(result.status)
        ? result.status
        : "unknown";
      const id = /^[a-f\d-]{36}$/i.test(result.id)
        ? ` Submission ID: ${result.id}.`
        : "";
      throw new Error(
        `Apple notarization was not Accepted (status: ${status}).${id} No final ZIP has been created.`,
      );
    }
    console.log("Notarization Accepted. Stapling and validating the ticket…");
    run("Staple notarization ticket", "/usr/bin/xcrun", [
      "stapler",
      "staple",
      bundle,
    ]);
    run("Validate stapled ticket", "/usr/bin/xcrun", [
      "stapler",
      "validate",
      bundle,
    ]);
    const verification = verifyPackage(bundle, { probeNative: true });
    run("Verify stapled Developer ID app", "/usr/bin/codesign", [
      "--verify",
      "--deep",
      "--strict",
      "-R",
      requirement,
      bundle,
    ]);
    run("Gatekeeper assessment", "/usr/sbin/spctl", [
      "--assess",
      "--type",
      "execute",
      "--verbose=4",
      bundle,
    ]);
    const finalZip = path.join(temporary, "final.zip"),
      finalChecksum = path.join(temporary, "final.sha256");
    run(
      "Archive stapled application",
      "/usr/bin/ditto",
      ["-c", "-k", "--sequesterRsrc", "--keepParent", bundle, finalZip],
      { timeout: 600000 },
    );
    const sha256 = fileHash(finalZip);
    fs.writeFileSync(finalChecksum, `${sha256}  ${name}\n`, { mode: 0o644 });
    // Hard links publish completed files without overwriting another release.
    fs.linkSync(finalZip, zip);
    try {
      fs.linkSync(finalChecksum, checksum);
    } catch (error) {
      if (fs.statSync(zip).ino === fs.statSync(finalZip).ino)
        fs.unlinkSync(zip);
      throw error;
    }
    console.log(
      `Notarized ZIP: ${zip}\nSHA-256 file: ${checksum}\nStapled app: ${bundle}`,
    );
    return {
      bundle,
      zip,
      checksum,
      sha256,
      notarized: true,
      nativePtyVerified: verification.nativePtyVerified === true,
    };
  } catch (error) {
    throw new Error(sanitize(error.message));
  } finally {
    if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
    if (lock !== undefined) {
      fs.closeSync(lock);
      fs.unlinkSync(lockPath);
    }
  }
}

if (require.main === module) {
  try {
    if (process.argv.slice(2).some((arg) => arg !== "--check"))
      throw new Error("Usage: node scripts/release-macos.cjs [--check]");
    releaseMac({ checkOnly: process.argv.includes("--check") });
  } catch (error) {
    console.error("Release failed:", sanitizer()(error.message));
    process.exitCode = 1;
  }
}

module.exports = {
  releaseMac,
  configuration,
  sanitizer,
  buildEnvironment,
  installedIdentity,
  signedIdentity,
};
