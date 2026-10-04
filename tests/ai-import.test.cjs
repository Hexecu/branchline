/* Copyright (C) 2026 Davide Leopardi
 * SPDX-License-Identifier: GPL-3.0-only */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { parseEnv, profilesFromFile } = require("../electron/ai-import.cjs");

// All credentials below are synthetic. No environment or personal config is read.
const KEY = "fixture-import-secret-725b";
const TOKEN = "fixture-import-token-a861";
const PRIVATE_KEY = "fixture-only-private-key-304c";
const MODEL = "azure/harness-model-exact-2026";

function fixture(t) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "branchline-ai-import-test-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return {
    directory,
    write(name, text) {
      const file = path.join(directory, name);
      fs.writeFileSync(file, text, { mode: 0o600 });
      return file;
    },
  };
}

function assertPublic(profile) {
  const serialized = JSON.stringify(profile);
  for (const value of [KEY, TOKEN, PRIVATE_KEY]) {
    assert.equal(
      serialized.includes(value),
      false,
      "a credential reached the public profile",
    );
  }
  for (const key of [
    "credentials",
    "apiKey",
    "bearerToken",
    "secretAccessKey",
    "sessionToken",
    "serviceAccount",
    "private_key",
  ]) {
    assert.equal(
      Object.hasOwn(profile, key),
      false,
      `public profile contains credential field ${key}`,
    );
  }
}

async function rejectsSafely(operation) {
  await assert.rejects(
    async () => operation(),
    (error) => {
      assert.ok(error instanceof Error);
      assert.ok(
        error.message.trim(),
        "invalid input must produce an explicit error",
      );
      for (const value of [KEY, TOKEN, PRIVATE_KEY]) {
        assert.equal(
          error.message.includes(value),
          false,
          "error includes imported credentials",
        );
      }
      return true;
    },
  );
}

test("environment parser preserves shell expressions literally without executing or interpolating them", (t) => {
  const { directory } = fixture(t);
  const sentinel = path.join(directory, "must-not-exist");
  const values = parseEnv(
    [
      "# literal env fixture",
      `export LITELLM_KEY="${KEY}" # comment`,
      "LITELLM_MODEL=${SOME_TEST_MODEL}",
      "REFERENCE=$LITELLM_KEY",
      `COMMAND=$(touch "${sentinel}")`,
      `BACKTICK=\`touch "${sentinel}"\``,
      'WITH_HASH="value # remains quoted"',
      "UNQUOTED=value # inline comment",
      "ignored non-assignment",
    ].join("\r\n"),
  );
  assert.equal(values.LITELLM_KEY, KEY);
  assert.equal(values.LITELLM_MODEL, "${SOME_TEST_MODEL}");
  assert.equal(values.REFERENCE, "$LITELLM_KEY");
  assert.equal(values.COMMAND, `$(touch "${sentinel}")`);
  assert.equal(values.BACKTICK, `\`touch "${sentinel}"\``);
  assert.equal(values.WITH_HASH, "value # remains quoted");
  assert.equal(values.UNQUOTED, "value");
  assert.equal(fs.existsSync(sentinel), false);
});

test("environment parser accepts multiline quotes, escaped inner quotes, and service-account JSON", () => {
  const serviceAccount = {
    type: "service_account",
    private_key: `${PRIVATE_KEY}\nsecond key line`,
    client_email: "fixture@example.invalid",
  };
  const quotedAccount = JSON.stringify(serviceAccount, null, 2)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
  const input = [
    'PRIVATE_KEY="first \\"quoted\\" segment',
    'second line"',
    'ESCAPED="line one\\nline two"',
    "SERVICE_ACCOUNT='{",
    '  "type": "service_account",',
    `  "private_key": "${PRIVATE_KEY}",`,
    '  "client_email": "fixture@example.invalid"',
    "}'",
    `DOUBLE_ACCOUNT="${quotedAccount}"`,
  ].join("\n");
  const values = parseEnv(input);
  assert.equal(values.PRIVATE_KEY, 'first "quoted" segment\nsecond line');
  assert.equal(values.ESCAPED, "line one\nline two");
  assert.equal(JSON.parse(values.SERVICE_ACCOUNT).private_key, PRIVATE_KEY);
  assert.deepEqual(JSON.parse(values.DOUBLE_ACCOUNT), serviceAccount);
});

test("LiteLLM Harness environment import preserves endpoint, exact model, and private API key", async (t) => {
  const { write } = fixture(t);
  const file = write(
    "harness.env",
    [
      "LITELLM_ENDPOINT=https://gateway.example.invalid/llm/v1",
      `LITELLM_KEY=${KEY}`,
      `LLM_MODEL=${MODEL}`,
    ].join("\n"),
  );
  const entries = await profilesFromFile(file);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].profile.provider, "litellm");
  assert.equal(
    entries[0].profile.baseUrl,
    "https://gateway.example.invalid/llm/v1",
  );
  assert.equal(entries[0].profile.model, MODEL);
  assert.deepEqual(entries[0].credentials, { apiKey: KEY });
  assertPublic(entries[0].profile);
});

test("environment aliases map provider metadata separately from credentials", async (t) => {
  const { write } = fixture(t);
  const cases = [
    {
      name: "openai",
      env: `OPENAI_API_KEY=${KEY}\nOPENAI_MODEL=${MODEL}`,
      provider: "openai",
      model: MODEL,
      credentials: { apiKey: KEY },
    },
    {
      name: "compatible",
      env: `OPENAI_API_KEY=${KEY}\nOPENAI_BASE_URL=https://models.example.invalid/v1\nOPENAI_MODEL=${MODEL}`,
      provider: "compatible",
      model: MODEL,
      credentials: { apiKey: KEY },
    },
    {
      name: "litellm",
      env: `LITELLM_BASE_URL=https://models.example.invalid/v1\nLITELLM_API_KEY=${KEY}\nLITELLM_MODEL=${MODEL}`,
      provider: "litellm",
      model: MODEL,
      credentials: { apiKey: KEY },
    },
    {
      name: "azure",
      env: `AZURE_OPENAI_ENDPOINT=https://fixture.openai.azure.com\nAZURE_OPENAI_API_KEY=${KEY}\nAZURE_OPENAI_DEPLOYMENT=deployment-fixture\nAZURE_OPENAI_API_VERSION=2024-10-21`,
      provider: "azure",
      model: "deployment-fixture",
      credentials: { apiKey: KEY },
      metadata: { apiVersion: "2024-10-21", authMode: "apiKey" },
    },
    {
      name: "google",
      env: `GEMINI_API_KEY=${KEY}\nGEMINI_MODEL=gemini-fixture`,
      provider: "google",
      model: "gemini-fixture",
      credentials: { apiKey: KEY },
    },
    {
      name: "vertex",
      env: `GOOGLE_CLOUD_PROJECT=fixture-project\nGOOGLE_CLOUD_LOCATION=us-central1\nGOOGLE_ACCESS_TOKEN=${TOKEN}\nVERTEX_MODEL=gemini-fixture`,
      provider: "vertex",
      model: "gemini-fixture",
      credentials: { bearerToken: TOKEN },
      metadata: {
        project: "fixture-project",
        location: "us-central1",
        authMode: "bearer",
      },
    },
    {
      name: "vertex-adc",
      env: "GCLOUD_PROJECT=fixture-project\nVERTEX_MODEL=gemini-fixture",
      provider: "vertex",
      model: "gemini-fixture",
      credentials: undefined,
      metadata: { authMode: "adc" },
    },
    {
      name: "bedrock",
      env: `AWS_DEFAULT_REGION=eu-west-1\nAWS_ACCESS_KEY_ID=fixture-access-id\nAWS_SECRET_ACCESS_KEY=${KEY}\nAWS_SESSION_TOKEN=${TOKEN}\nBEDROCK_MODEL=eu.provider.fixture:0`,
      provider: "bedrock",
      model: "eu.provider.fixture:0",
      credentials: {
        accessKeyId: "fixture-access-id",
        secretAccessKey: KEY,
        sessionToken: TOKEN,
      },
      metadata: { region: "eu-west-1", authMode: "aws" },
    },
    {
      name: "bedrock-profile",
      env: "AWS_REGION=eu-west-1\nAWS_PROFILE=fixture-profile\nBEDROCK_MODEL=eu.provider.fixture:0",
      provider: "bedrock",
      model: "eu.provider.fixture:0",
      credentials: undefined,
      metadata: { awsProfile: "fixture-profile", authMode: "awsProfile" },
    },
    {
      name: "ollama",
      env: "OLLAMA_BASE_URL=http://127.0.0.1:11434\nOLLAMA_MODEL=fixture:latest",
      provider: "ollama",
      model: "fixture:latest",
      credentials: undefined,
    },
  ];
  for (const item of cases) {
    const entries = await profilesFromFile(write(`${item.name}.env`, item.env));
    assert.equal(entries.length, 1, item.name);
    const { profile, credentials } = entries[0];
    assert.equal(profile.provider, item.provider, item.name);
    assert.equal(profile.model, item.model, item.name);
    assert.deepEqual(credentials, item.credentials, item.name);
    for (const [key, value] of Object.entries(item.metadata || {}))
      assert.equal(profile[key], value, item.name);
    assertPublic(profile);
  }
  const combined = await profilesFromFile(
    write(
      "multiple.env",
      `LITELLM_ENDPOINT=https://gateway.example.invalid/v1\nLITELLM_KEY=${KEY}\nLITELLM_MODEL=gemini-fixture\nOPENAI_API_KEY=${TOKEN}\nOPENAI_MODEL=openai-fixture`,
    ),
  );
  assert.deepEqual(
    combined.map((entry) => entry.profile.provider),
    ["litellm", "openai"],
  );
  assert.deepEqual(
    combined.map((entry) => entry.credentials.apiKey),
    [KEY, TOKEN],
  );
  combined.forEach((entry) => assertPublic(entry.profile));
});

test("JSON service-account and relative environment file imports keep the account private", async (t) => {
  const { write } = fixture(t);
  const text = JSON.stringify(
    {
      type: "service_account",
      project_id: "fixture-project",
      private_key: PRIVATE_KEY,
      client_email: "fixture@example.invalid",
    },
    null,
    2,
  );
  const direct = await profilesFromFile(write("account.json", text));
  assert.equal(direct.length, 1);
  assert.equal(direct[0].profile.provider, "vertex");
  assert.equal(direct[0].profile.project, "fixture-project");
  assert.equal(direct[0].profile.authMode, "serviceAccount");
  assert.deepEqual(direct[0].credentials, { serviceAccount: text });
  assertPublic(direct[0].profile);
  const env = await profilesFromFile(
    write(
      "vertex.env",
      "GOOGLE_CLOUD_PROJECT=fixture-project\nGOOGLE_APPLICATION_CREDENTIALS=account.json\nVERTEX_MODEL=gemini-fixture",
    ),
  );
  assert.equal(env.length, 1);
  assert.equal(env[0].profile.authMode, "serviceAccount");
  assert.equal(env[0].profile.model, "gemini-fixture");
  assert.deepEqual(env[0].credentials, { serviceAccount: text });
  assertPublic(env[0].profile);
});

test("JSON profile imports never copy embedded credential fields into public metadata", async (t) => {
  const { write } = fixture(t);
  const input = {
    profiles: [
      {
        profile: {
          id: "json-fixture",
          name: "Synthetic connection",
          provider: "compatible",
          model: MODEL,
          baseUrl: "https://models.example.invalid/v1",
          apiKey: KEY,
          bearerToken: TOKEN,
          private_key: PRIVATE_KEY,
          credentials: { apiKey: KEY },
        },
        credentials: { apiKey: KEY },
      },
    ],
  };
  const entries = await profilesFromFile(
    write("profiles.json", JSON.stringify(input)),
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].profile.id, "json-fixture");
  assert.equal(entries[0].profile.model, MODEL);
  assert.deepEqual(entries[0].credentials, { apiKey: KEY });
  assertPublic(entries[0].profile);
});

test("invalid, empty, unterminated, and oversize configuration files fail without exposing credentials", async (t) => {
  const { directory, write } = fixture(t);
  const files = [
    write("bad.json", `{ "credentials": { "apiKey": "${KEY}" }`),
    write("number.json", "42"),
    write("empty.env", "# no supported settings"),
    write("unterminated.env", `OPENAI_API_KEY="${KEY}`),
    write("oversize.env", `OPENAI_API_KEY=${KEY}\n` + "#".repeat(262145)),
    write(
      "too-many.json",
      JSON.stringify({
        profiles: Array.from({ length: 31 }, () => ({ provider: "ollama" })),
      }),
    ),
    directory,
  ];
  for (const file of files) await rejectsSafely(() => profilesFromFile(file));
  write("bad-account.json", `{ "private_key": "${PRIVATE_KEY}"`);
  await rejectsSafely(() =>
    profilesFromFile(
      write(
        "bad-account.env",
        "GOOGLE_CLOUD_PROJECT=fixture-project\nGOOGLE_APPLICATION_CREDENTIALS=bad-account.json",
      ),
    ),
  );
  write("oversize-account.json", " ".repeat(131073));
  await rejectsSafely(() =>
    profilesFromFile(
      write(
        "oversize-account.env",
        "GOOGLE_CLOUD_PROJECT=fixture-project\nGOOGLE_APPLICATION_CREDENTIALS=oversize-account.json",
      ),
    ),
  );
});
