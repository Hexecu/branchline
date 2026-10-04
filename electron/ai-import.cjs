/* Copyright (C) 2026 Davide Leopardi
 * SPDX-License-Identifier: GPL-3.0-only */

"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const PROFILE_FIELDS = [
  "id",
  "name",
  "provider",
  "baseUrl",
  "model",
  "apiVersion",
  "project",
  "location",
  "region",
  "awsProfile",
  "authMode",
];

function parseEnv(text) {
  const values = {};
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const match = /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(
      lines[index],
    );
    if (!match) continue;
    let value = match[2].trim();
    const quote = value[0];
    if (quote === '"' || quote === "'") {
      let end = -1;
      for (let cursor = 1; ; cursor++) {
        if (cursor >= value.length) {
          if (index + 1 >= lines.length) break;
          value += "\n" + lines[++index];
        }
        if (quote === '"' && value[cursor] === "\\") {
          cursor++;
          continue;
        }
        if (value[cursor] === quote) {
          end = cursor;
          break;
        }
      }
      if (end < 0)
        throw new Error("Il file ambiente contiene un valore non chiuso.");
      if (
        value.slice(end + 1).trim() &&
        !value
          .slice(end + 1)
          .trim()
          .startsWith("#")
      )
        throw new Error(
          "Il file ambiente contiene testo dopo un valore quotato.",
        );
      value = value.slice(1, end);
      if (quote === '"')
        value = value.replace(
          /\\([nr"\\])/g,
          (_, escaped) => ({ n: "\n", r: "\r", '"': '"', "\\": "\\" })[escaped],
        );
    } else value = value.replace(/\s+#.*$/, "").trim();
    values[match[1]] = value;
  }
  return values;
}
function usable(value) {
  return (
    typeof value === "string" &&
    !!value.trim() &&
    !/your[-_ ]|placeholder|changeme|^\$\{|^sk-test\b/i.test(value)
  );
}
async function profilesFromFile(filename) {
  const stat = await fs.stat(filename);
  if (!stat.isFile() || stat.size > 262144)
    throw new Error("Importa un file JSON o ambiente di massimo 256 KB.");
  const text = await fs.readFile(filename, "utf8");
  if (filename.toLowerCase().endsWith(".json")) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Il file JSON delle impostazioni AI non è valido.");
    }
    if (
      data?.type === "service_account" &&
      data.private_key &&
      data.client_email
    )
      return [
        {
          profile: {
            id: randomUUID(),
            name: "Vertex · account di servizio",
            provider: "vertex",
            project: data.project_id || "",
            location: "global",
            authMode: "serviceAccount",
            model: "",
          },
          credentials: { serviceAccount: text },
        },
      ];
    const entries = Array.isArray(data?.profiles) ? data.profiles : [data];
    if (
      !entries.length ||
      entries.length > 30 ||
      entries.some((entry) => !entry || typeof entry !== "object")
    )
      throw new Error(
        "Il JSON deve contenere un profilo AI o una lista profiles.",
      );
    return entries.map((entry) => {
      const source = entry.profile || entry;
      const profile = Object.fromEntries(
        PROFILE_FIELDS.filter((field) => source[field] !== undefined).map(
          (field) => [field, source[field]],
        ),
      );
      profile.id ||= randomUUID();
      return { profile, credentials: entry.credentials };
    });
  }
  const env = parseEnv(text);
  const result = [];
  const add = (profile, credentials) =>
    result.push({
      profile: { id: randomUUID(), model: "", ...profile },
      credentials,
    });
  const gateway =
    env.LITELLM_ENDPOINT || env.LITELLM_BASE_URL || env.LITELLM_API_BASE;
  const gatewayKey = env.LITELLM_KEY || env.LITELLM_API_KEY;
  if (usable(gateway) && usable(gatewayKey))
    add(
      {
        name: "LiteLLM importato",
        provider: "litellm",
        baseUrl: gateway,
        model: env.LITELLM_MODEL || env.LLM_MODEL || "",
      },
      { apiKey: gatewayKey },
    );
  if (usable(env.OPENAI_API_KEY)) {
    const baseUrl =
      env.OPENAI_BASE_URL || env.OPENAI_API_BASE || "https://api.openai.com/v1";
    const provider = /litellm/i.test(baseUrl)
      ? "litellm"
      : baseUrl.startsWith("https://api.openai.com")
        ? "openai"
        : "compatible";
    add(
      {
        name: provider === "litellm" ? "LiteLLM importato" : "OpenAI importato",
        provider,
        baseUrl,
        model: env.OPENAI_MODEL || env.LLM_MODEL || "",
      },
      { apiKey: env.OPENAI_API_KEY },
    );
  }
  if (usable(env.AZURE_OPENAI_ENDPOINT) && usable(env.AZURE_OPENAI_API_KEY))
    add(
      {
        name: "Azure OpenAI importato",
        provider: "azure",
        baseUrl: env.AZURE_OPENAI_ENDPOINT,
        apiVersion: env.AZURE_OPENAI_API_VERSION || "",
        model: env.AZURE_OPENAI_DEPLOYMENT || env.AZURE_OPENAI_MODEL || "",
        authMode: "apiKey",
      },
      { apiKey: env.AZURE_OPENAI_API_KEY },
    );
  const googleKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (usable(googleKey))
    add(
      {
        name: "Google AI Studio importato",
        provider: "google",
        model: env.GEMINI_MODEL || "",
      },
      { apiKey: googleKey },
    );
  const project = env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT;
  if (usable(project)) {
    let credentials,
      authMode = "adc";
    if (usable(env.GOOGLE_APPLICATION_CREDENTIALS)) {
      const serviceFile = path.resolve(
        path.dirname(filename),
        env.GOOGLE_APPLICATION_CREDENTIALS,
      );
      const serviceStat = await fs.stat(serviceFile);
      if (!serviceStat.isFile() || serviceStat.size > 131072)
        throw new Error("File account di servizio Vertex non valido.");
      const serviceAccount = await fs.readFile(serviceFile, "utf8");
      try {
        JSON.parse(serviceAccount);
      } catch {
        throw new Error("JSON account di servizio Vertex non valido.");
      }
      credentials = { serviceAccount };
      authMode = "serviceAccount";
    } else if (usable(env.GOOGLE_ACCESS_TOKEN)) {
      credentials = { bearerToken: env.GOOGLE_ACCESS_TOKEN };
      authMode = "bearer";
    }
    add(
      {
        name: "Vertex AI importato",
        provider: "vertex",
        project,
        location: env.GOOGLE_CLOUD_LOCATION || "global",
        model: env.VERTEX_MODEL || env.GEMINI_MODEL || "",
        authMode,
      },
      credentials,
    );
  }
  const region = env.AWS_REGION || env.AWS_DEFAULT_REGION;
  if (
    usable(region) &&
    (usable(env.AWS_BEARER_TOKEN_BEDROCK) ||
      usable(env.AWS_ACCESS_KEY_ID) ||
      usable(env.AWS_PROFILE))
  ) {
    const apiKey = env.AWS_BEARER_TOKEN_BEDROCK;
    const credentials = usable(apiKey)
      ? { apiKey }
      : usable(env.AWS_ACCESS_KEY_ID)
        ? {
            accessKeyId: env.AWS_ACCESS_KEY_ID,
            secretAccessKey: env.AWS_SECRET_ACCESS_KEY || "",
            sessionToken: env.AWS_SESSION_TOKEN || "",
          }
        : undefined;
    add(
      {
        name: "Bedrock importato",
        provider: "bedrock",
        region,
        awsProfile: env.AWS_PROFILE || "",
        authMode: usable(apiKey)
          ? "apiKey"
          : credentials
            ? "aws"
            : "awsProfile",
        model: env.BEDROCK_MODEL || "",
      },
      credentials,
    );
  }
  if (usable(env.OLLAMA_BASE_URL))
    add({
      name: "Ollama importato",
      provider: "ollama",
      baseUrl: env.OLLAMA_BASE_URL,
      model: env.OLLAMA_MODEL || "",
    });
  if (!result.length)
    throw new Error(
      "Nessuna configurazione AI riconosciuta. Usa chiavi e endpoint OpenAI, LiteLLM, Azure, Google, Vertex, Bedrock oppure un JSON di profili.",
    );
  return result;
}

module.exports = { parseEnv, profilesFromFile, usable };
