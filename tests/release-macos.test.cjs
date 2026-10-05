/* Copyright (C) 2026 Davide Leopardi
 * SPDX-License-Identifier: GPL-3.0-only */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const crypto = require("node:crypto");
const {
  configuration,
  sanitizer,
  buildEnvironment,
  installedIdentity,
  signedIdentity,
} = require("../scripts/release-macos.cjs");

// All certificate/tool responses below are synthetic. No signing, Keychain
// lookup, notarization request or Gatekeeper change is executed by these tests.
const root = path.resolve(__dirname, "..");
const identity = "Developer ID Application: Branchline QA (ABCDE12345)";
const hash = "A".repeat(40);
const environment = {
  BRANCHLINE_SIGN_IDENTITY: identity,
  BRANCHLINE_NOTARY_PROFILE: "branchline-qa",
};
const signature =
  `Authority=${identity}\nTeamIdentifier=ABCDE12345\n` +
  "CodeDirectory v=20500 size=644 flags=0x10000(runtime) hashes=9+7 location=embedded\n" +
  "Timestamp=Oct 2, 2026 at 12:00:00";

test("release preflight rejects missing, foreign, ambiguous and non-Developer-ID identities", () => {
  assert.throws(() => configuration({}, "darwin", "arm64"), /Set BRANCHLINE/);
  assert.throws(
    () => configuration(environment, "linux", "x64"),
    /requires macOS/,
  );
  for (const value of [
    "-",
    "Apple Development: QA (ABCDE12345)",
    "Developer ID Application: QA\n(ABCDE12345)",
    "Developer ID Application: QA (wrong)",
  ])
    assert.throws(
      () =>
        configuration(
          { ...environment, BRANCHLINE_SIGN_IDENTITY: value },
          "darwin",
          "arm64",
        ),
      /full, exact/,
    );
  assert.throws(
    () =>
      configuration(
        { ...environment, BRANCHLINE_NOTARY_PROFILE: "--force" },
        "darwin",
        "arm64",
      ),
    /profile name/,
  );
  assert.equal(
    installedIdentity(
      `1) ${hash} "${identity}"\n1 valid identities found`,
      identity,
    ),
    hash,
  );
  assert.throws(
    () => installedIdentity(`1) ${hash} "Other"`, identity),
    /missing or ambiguous/,
  );
  assert.throws(
    () =>
      installedIdentity(
        `1) ${hash} "${identity}"\n2) ${"B".repeat(40)} "${identity}"`,
        identity,
      ),
    /ambiguous/,
  );
  signedIdentity(signature, { identity, teamId: "ABCDE12345" });
  for (const invalid of [
    signature.replace("(runtime)", "(adhoc)"),
    signature.replace("ABCDE12345", "FOREIGN123"),
    signature.replace(/Timestamp=.+/, ""),
  ])
    assert.throws(
      () => signedIdentity(invalid, { identity, teamId: "ABCDE12345" }),
      /hardened runtime/,
    );
});

test("Developer ID inspection accepts actual codesign CodeDirectory output and rejects missing or misleading runtime flags", () => {
  const config = { identity, teamId: "ABCDE12345" };
  signedIdentity(signature, config);
  signedIdentity(
    signature.replace("0x10000(runtime)", "0x10001(hard,runtime)"),
    config,
  );
  for (const invalid of [
    signature.replace("flags=0x10000(runtime)", "flags=0x0(runtime)"),
    signature.replace("flags=0x10000(runtime)", "flags=0x10000(noruntime)"),
    signature.replace("flags=0x10000(runtime)", "flags=0x0(none) runtime"),
    signature.replace("flags=0x10000(runtime)", "flags=0x10000() runtime"),
    signature.replace("CodeDirectory v=", "CodeDirectory=v="),
    signature.replace(/CodeDirectory[^\n]+\n/, "runtime\n"),
    signature + "\nCodeDirectory v=20500 size=644 flags=0x10000(runtime)",
  ])
    assert.throws(() => signedIdentity(invalid, config), /hardened runtime/);
});

test("release child environment removes unrelated credentials and errors remain bounded and redacted", () => {
  const secret = "fixture-secret-value";
  const env = {
    ...environment,
    CSC_LINK: secret,
    APPLE_API_KEY: secret,
    LITELLM_KEY: secret,
    AWS_ACCESS_KEY_ID: secret,
    API_TOKEN: secret,
    PATH: "/usr/bin",
  };
  const clean = buildEnvironment(env);
  for (const key of Object.keys(env).filter((key) => key !== "PATH"))
    assert.equal(clean[key], undefined, key);
  assert.equal(clean.CSC_IDENTITY_AUTO_DISCOVERY, "false");
  assert.equal(clean.PATH, "/usr/bin");
  const redact = sanitizer(env);
  const message = redact(
    `Error ${secret} Bearer abcdef token=defgh https://user:pass@example.invalid/path {"password":"unknown-value"} https://upload.example.invalid/file?signature=signed-query`,
  );
  assert.doesNotMatch(
    message,
    /fixture-secret-value|abcdef|defgh|user:pass|unknown-value|signed-query/,
  );
  assert.ok(redact("x".repeat(10000)).length <= 4096);
});

function loadWithMocks(home, outcome) {
  const calls = [],
    logs = [];
  const leaf = "-----BEGIN CERTIFICATE-----\nLEAF\n-----END CERTIFICATE-----";
  const appleRoot =
    "-----BEGIN CERTIFICATE-----\nROOT\n-----END CERTIFICATE-----";
  const secret = "fixture-secret-value";
  class MockCertificate {
    constructor(pem) {
      this.fingerprint = hash.match(/.{2}/g).join(":");
      this.subject = pem.includes("ROOT")
        ? "CN=Apple Root CA\nO=Apple Inc."
        : `CN=${identity}\nOU=ABCDE12345`;
      this.issuer = "CN=Developer ID Certification Authority\nO=Apple Inc.";
    }
  }
  function spawn(executable, args, options) {
    calls.push({ executable, args, options });
    let stdout = "",
      stderr = "",
      status = 0;
    if (executable === "/usr/bin/security" && args[0] === "find-identity")
      stdout = `1) ${hash} "${identity}"`;
    else if (
      executable === "/usr/bin/security" &&
      args[0] === "find-certificate"
    )
      stdout = args.includes("-c") ? leaf : appleRoot;
    else if (executable === "/usr/bin/codesign" && args.includes("-d"))
      stderr = signature;
    else if (executable === "/usr/bin/ditto")
      fs.writeFileSync(
        args.at(-1),
        args.at(-1).includes("final") ? "stapled-zip" : "unstapled-zip",
      );
    else if (args[0] === "notarytool" && args[1] === "submit")
      stdout =
        outcome === "bad-json"
          ? "not-json"
          : JSON.stringify({
              status: outcome === "Invalid" ? "Invalid" : "Accepted",
              id: "11111111-1111-1111-1111-111111111111",
            });
    else if (
      (outcome === "staple-failed" &&
        args[0] === "stapler" &&
        args[1] === "staple") ||
      (outcome === "assessment-failed" && executable === "/usr/sbin/spctl")
    ) {
      status = 1;
      stderr = secret;
    }
    return { status, stdout, stderr };
  }
  const mocks = {
    "node:crypto": { ...crypto, X509Certificate: MockCertificate },
    "node:child_process": { spawnSync: spawn },
    "node:os": { ...os, homedir: () => home },
    "./verify-package.cjs": {
      verifyPackage: (bundle, options) => {
        assert.equal(options.probeNative, true);
        assert.ok(bundle.startsWith(home + path.sep));
        return { nativePtyVerified: true };
      },
    },
    "./package-macos.cjs": {
      packageMac: ({ identity: selected, outputDir, env, run }) => {
        assert.equal(selected, hash);
        assert.equal(env.CSC_LINK, undefined);
        assert.equal(env.APPLE_PASSWORD, undefined);
        run("mock-builder", [], { env });
        const bundle = path.join(outputDir, "mac-arm64", "Branchline.app");
        fs.mkdirSync(bundle, { recursive: true });
        return { bundle };
      },
    },
  };
  const module = { exports: {} };
  function mockRequire(name) {
    if (mocks[name]) return mocks[name];
    if (name.endsWith("package.json")) return { version: "0.4.0" };
    return require(name);
  }
  vm.runInNewContext(
    fs.readFileSync(path.join(root, "scripts/release-macos.cjs"), "utf8"),
    {
      module,
      exports: module.exports,
      require: mockRequire,
      __dirname: path.join(root, "scripts"),
      process: { ...process, platform: "darwin", arch: "arm64" },
      Buffer,
      console: { log: (...args) => logs.push(args.join(" ")) },
    },
    { filename: "mock-release-macos.cjs" },
  );
  return { service: module.exports, calls, logs, secret };
}

for (const outcome of [
  "Accepted",
  "Invalid",
  "bad-json",
  "staple-failed",
  "assessment-failed",
])
  test(`notarization outcome ${outcome} gates ticket verification and final archive`, () => {
    const home = fs.mkdtempSync(
      path.join(os.tmpdir(), "branchline-release-test-"),
    );
    try {
      const { service, calls, logs, secret } = loadWithMocks(home, outcome);
      let result, error;
      try {
        result = service.releaseMac({
          env: {
            ...environment,
            API_TOKEN: secret,
            CSC_LINK: secret,
            APPLE_PASSWORD: secret,
          },
        });
      } catch (failure) {
        error = failure;
      }
      const submitted = calls.find(
        (call) => call.args[0] === "notarytool" && call.args[1] === "submit",
      );
      assert.ok(submitted);
      assert.ok(submitted.args.includes("--keychain-profile"));
      assert.ok(!submitted.args.includes("--password"));
      assert.ok(!submitted.args.includes("--force"));
      assert.equal(submitted.options.env.API_TOKEN, undefined);
      assert.equal(submitted.options.env.CSC_LINK, undefined);
      assert.equal(submitted.options.env.APPLE_PASSWORD, undefined);
      const requirementChecks = calls.filter(
        (call) =>
          call.executable === "/usr/bin/codesign" && call.args.includes("-R"),
      );
      assert.equal(
        requirementChecks.length,
        outcome === "Accepted" || outcome === "assessment-failed" ? 2 : 1,
      );
      for (const call of requirementChecks)
        assert.equal(
          call.args[call.args.indexOf("-R") + 1],
          '=anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "ABCDE12345"',
        );
      const finalArchive = calls.find(
        (call) =>
          call.executable === "/usr/bin/ditto" &&
          call.args.at(-1).endsWith("final.zip"),
      );
      if (outcome === "Accepted") {
        assert.equal(error, undefined);
        assert.ok(fs.existsSync(result.zip));
        assert.ok(fs.existsSync(result.checksum));
        assert.equal(result.nativePtyVerified, true);
        assert.match(
          fs.readFileSync(result.checksum, "utf8"),
          new RegExp(result.sha256),
        );
        assert.ok(finalArchive);
        assert.ok(
          calls.find(
            (call) => call.args[0] === "stapler" && call.args[1] === "validate",
          ),
        );
        assert.ok(calls.find((call) => call.executable === "/usr/sbin/spctl"));
      } else {
        assert.ok(error);
        assert.equal(finalArchive, undefined);
        assert.ok(!error.message.includes(secret));
        if (outcome === "Invalid" || outcome === "bad-json")
          assert.ok(!calls.find((call) => call.args[0] === "stapler"));
      }
      assert.ok(!logs.join("\n").includes(secret));
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

test("signed packaging pins identity, disables publishing/automatic notarization, and uses x64 mac output", () => {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "branchline-package-test-"),
  );
  try {
    const calls = [],
      module = { exports: {} };
    function mockRequire(name) {
      if (name === "./verify-package.cjs")
        return {
          verifyPackage: (bundle, options) => {
            assert.equal(
              bundle,
              path.join(fs.realpathSync(temporary), "mac", "Branchline.app"),
            );
            assert.equal(options.probeNative, true);
            return { nativePtyVerified: true };
          },
        };
      if (name.endsWith("package.json")) return { version: "0.4.0" };
      return require(name);
    }
    mockRequire.resolve = require.resolve;
    vm.runInNewContext(
      fs.readFileSync(path.join(root, "scripts/package-macos.cjs"), "utf8"),
      {
        module,
        exports: module.exports,
        require: mockRequire,
        __dirname: path.join(root, "scripts"),
        process: { ...process, platform: "darwin", arch: "x64" },
        console,
      },
    );
    module.exports.packageMac({
      identity: hash,
      outputDir: temporary,
      run: (file, args) => calls.push({ file, args }),
      log: () => {},
    });
    const args = calls.at(-1).args;
    assert.ok(args.includes(`--config.mac.identity=${hash}`));
    assert.ok(args.includes("--config.forceCodeSigning=true"));
    assert.ok(args.includes("--config.mac.hardenedRuntime=true"));
    assert.ok(args.includes("--config.mac.notarize=false"));
    assert.ok(args.includes("--publish"));
    assert.equal(args[args.indexOf("--publish") + 1], "never");
    assert.equal(
      args[args.indexOf("--require") + 1],
      path.join(root, "scripts/builder-download.cjs"),
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("owned package output uses the canonical directory through a symlink", (t) => {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "branchline-output-"),
  );
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const target = path.join(temporary, "owned-output");
  const linked = path.join(temporary, "linked-output");
  fs.mkdirSync(target);
  fs.symlinkSync(
    target,
    linked,
    process.platform === "win32" ? "junction" : "dir",
  );
  const module = { exports: {} },
    calls = [];
  function mockRequire(name) {
    if (name === "./verify-package.cjs") return { verifyPackage: () => ({}) };
    return require(name);
  }
  mockRequire.resolve = require.resolve;
  vm.runInNewContext(
    fs.readFileSync(path.join(root, "scripts/package-macos.cjs"), "utf8"),
    {
      module,
      exports: module.exports,
      require: mockRequire,
      __dirname: path.join(root, "scripts"),
      process: { ...process, platform: "darwin", arch: "x64" },
      console,
    },
  );
  const result = module.exports.packageMac({
    outputDir: linked,
    env: { ELECTRON_BUILDER_CACHE: path.join(temporary, "owned-cache") },
    buildRenderer: false,
    run: (file, args) => calls.push({ file, args }),
    log: () => {},
  });
  assert.equal(result.output, fs.realpathSync(target));
  assert.equal(
    result.bundle,
    path.join(fs.realpathSync(target), "mac", "Branchline.app"),
  );
  assert.ok(
    calls[0].args.includes(
      `--config.directories.output=${fs.realpathSync(target)}`,
    ),
  );
  assert.ok(
    calls[0].args.includes(
      `--config.electronDownload.cache=${path.join(temporary, "owned-cache", "electron")}`,
    ),
  );
});
