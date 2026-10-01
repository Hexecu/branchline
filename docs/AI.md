# AI providers and models

Branchline supports eight optional AI adapters. You select a profile and an exact model ID; the response is text for review. It does not modify files, create commits, or run Git commands.

Git operations work without AI. A cloud profile sends data to its configured service only when you explicitly generate a suggestion or run a synthetic connection test.

## Configure a profile

Open **Preferenze → Configura AI**, find the AI settings action in **⌘K**, or use **Strumenti → Assistente AI → Profili e modelli AI**.

Create a profile, select its provider and authentication method, and enter the required fields. Save it before discovering models or testing. A model can be entered manually; Azure uses a deployment name, and Bedrock may use a model ID or inference profile ID/ARN.

**Usa come attivo** persists the default profile and model without running inference. **Test connessione** sends a synthetic prompt with no repository content. In **Assistente AI**, **Genera suggerimento** sends the staged diff if any files are prepared, or the unstaged diff otherwise. The selected destination is displayed before that action.

Opening settings, loading saved profiles, and activating a model do not run inference. **Rileva modelli** is an explicit request to the provider's catalog where supported.

## Adapters and authentication

| Provider          | Configuration                                                                                                              | Adapter behavior and limits                                                                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI            | API key; default endpoint `https://api.openai.com/v1`. The bridge also supports bearer authentication.                     | Chat Completions. A catalog may include models that do not support this API.                                                                                                 |
| Azure OpenAI      | Resource endpoint and deployment name; API key or a manually supplied Entra bearer token. API version is optional.         | Empty version uses the v1 route; a dated version uses the deployment route. Enter deployment names manually. Static tokens are not renewed automatically.                    |
| Google AI Studio  | API key and an exact Gemini model ID.                                                                                      | Native `generateContent`; discovery filters models that advertise that generation method.                                                                                    |
| Vertex AI         | Google Cloud project, location, and Gemini model ID; local ADC, service-account JSON, or manual bearer token.              | Native Google `generateContent`. Enter the model manually; project permissions and model availability must be configured. ADC uses `google-auth-library`.                    |
| LiteLLM           | Gateway endpoint and API key. The bridge also supports bearer or no authentication.                                        | OpenAI-compatible Chat Completions using the ID exposed by the gateway. A local gateway may forward requests to cloud services.                                              |
| Amazon Bedrock    | Region and model/inference-profile ID or ARN; Bedrock API key, AWS keys with optional session token, or local AWS profile. | Native Converse. AWS credentials can list models; with a Bedrock API key, enter the model manually. Discovery does not prove permission or Converse/on-demand compatibility. |
| Ollama            | Loopback endpoint and a downloaded model; normally no authentication.                                                      | Native Ollama API. Checks declared local GGUF metadata and completion support, and rejects models declared as remote/cloud.                                                  |
| OpenAI-compatible | Server endpoint and model ID; no authentication, API key, or bearer token.                                                 | Chat Completions on a compatible server, such as LM Studio or vLLM. The default endpoint is local.                                                                           |

Provider support means the adapter is present, not that every account or model has been tested live. Runtime configuration, account permissions, quotas, billing, and model access remain external dependencies.

## Exact models and request limits

Branchline does not replace a failed model ID with another model. A returned model list is not an inference test. Azure and Vertex provide guidance for manual selection rather than claiming that a public model catalog proves deployment or project access.

Current limits:

- Generation and synthetic tests allow up to three minutes for inference and request up to 1,024 output tokens.
- The UTF-8 budget is **48,000 bytes** for the serialized request, diff, and system instructions together. Oversized input is rejected without silently truncating the diff.
- The request field allows up to 8,000 characters. A diff must be non-empty, contain no NUL, and be at most 100,000 characters, subject to the stricter combined byte budget.
- Provider responses are capped at 2 MiB. When a provider reports a generation-length cutoff, the returned text includes a truncation notice.
- Remote endpoints require HTTPS; HTTP is allowed on loopback. Embedded URL credentials and redirects are rejected.

If input is too large, prepare fewer files so the staging diff contains only the changes you want reviewed. If a catalog lists an unsuitable model, enter a model that supports the adapter's API and run **Test connessione**.

## Import `.env` or JSON

**Importa .env / JSON** accepts environment files and JSON up to 256 KiB. The original file is not modified. Canceling the native picker leaves the configuration unchanged and is reported as an unchanged or canceled import.

Environment files support `export`, comments, and quoted multiline values. Double-quoted values decode `\n`, `\r`, `\"`, and `\\`. Shell commands and `$VAR`/`${VAR}` references are not executed or expanded. Use actual values rather than references to another variable.

A local Ollama example:

```dotenv
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:3b
```

A gateway example, with values you must replace before use:

```dotenv
LITELLM_ENDPOINT=https://gateway.example.invalid/v1
LITELLM_KEY=replace-with-real-key
LITELLM_MODEL=exact-model-id-from-your-gateway
```

Supported environment names include:

| Provider          | Main variables                                                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI/compatible | `OPENAI_API_KEY`, `OPENAI_BASE_URL`/`OPENAI_API_BASE`, `OPENAI_MODEL`/`LLM_MODEL`                                                                          |
| LiteLLM           | `LITELLM_ENDPOINT`/`LITELLM_BASE_URL`/`LITELLM_API_BASE`, `LITELLM_KEY`/`LITELLM_API_KEY`, `LITELLM_MODEL`/`LLM_MODEL`                                     |
| Azure             | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT`/`AZURE_OPENAI_MODEL`, `AZURE_OPENAI_API_VERSION`                                |
| Google AI Studio  | `GEMINI_API_KEY`/`GOOGLE_API_KEY`, `GEMINI_MODEL`                                                                                                          |
| Vertex            | `GOOGLE_CLOUD_PROJECT`/`GCLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `VERTEX_MODEL`/`GEMINI_MODEL`, `GOOGLE_APPLICATION_CREDENTIALS` or `GOOGLE_ACCESS_TOKEN` |
| Bedrock           | `AWS_REGION`/`AWS_DEFAULT_REGION`, `BEDROCK_MODEL`, `AWS_BEARER_TOKEN_BEDROCK`, or AWS key/session-token variables, or `AWS_PROFILE`                       |
| Ollama            | `OLLAMA_BASE_URL`, `OLLAMA_MODEL`                                                                                                                          |

`GOOGLE_APPLICATION_CREDENTIALS` is resolved relative to the imported environment file and read as service-account JSON, up to 128 KiB. A Vertex profile without an imported account or token can use ADC already configured on the computer. Import does not initiate login or renew static tokens.

A JSON file can contain one profile or up to 30 entries in `profiles`. Keep public metadata and credentials separate:

```json
{
  "profiles": [
    {
      "profile": {
        "name": "Local compatible server",
        "provider": "compatible",
        "baseUrl": "http://127.0.0.1:1234/v1",
        "model": "exact-model-id-from-your-server",
        "authMode": "none"
      }
    },
    {
      "profile": {
        "name": "Example gateway",
        "provider": "litellm",
        "baseUrl": "https://gateway.example.invalid/v1",
        "model": "exact-model-id-from-your-gateway",
        "authMode": "apiKey"
      },
      "credentials": {
        "apiKey": "replace-with-real-key"
      }
    }
  ]
}
```

Credential fields are `apiKey`, `bearerToken`, `accessKeyId`, `secretAccessKey`, `sessionToken`, and `serviceAccount`. The latter holds the service-account JSON as a string. Unknown metadata fields are not copied into a profile. A Google service-account JSON file can also be imported directly; choose the model afterwards.

Generic import preserves the declared model and activates the first imported profile with a model. Review the active choice after importing multiple profiles. An optional local-harness shortcut may appear in the UI; it asks you to select a configuration file and applies its installation-specific preset. It does not search private directories automatically. File import is the portable workflow for declaring your own endpoint and exact model.

## Credentials and repository data

Profile metadata is stored in `ai/profiles.json` beneath Electron's application data directory. Encrypted credential blobs are stored separately in `ai/credentials.json`. Secrets are not included in profile metadata, and the renderer receives only their presence indicator, `hasCredential`.

The vault uses Electron `safeStorage`; on macOS, its encryption key is protected through Keychain. An unsigned application may prompt for Keychain access again after a rebuild or update. See [Electron's platform-specific key providers](https://www.electronjs.org/docs/latest/api/safe-storage#platform-specific-key-providers).

Vault writes are atomic, with directory permissions `0700` and credential-file permissions `0600`. Saving or decrypting credentials fails when OS protection is unavailable; the Linux `basic_text` backend is rejected. There is no plaintext-storage fallback. See the [vault implementation](../electron/ai-vault.cjs).

Saved secret values are never retrieved into the UI. Empty credential fields preserve existing credentials; deleting a profile removes its stored credential entry. Imported files may still contain plaintext secrets, so keep them outside version control and manage their permissions separately. Encryption of local storage does not change what an explicitly selected remote provider receives.

Ollama and compatible profiles with loopback endpoints can run locally. A gateway on localhost may still proxy cloud inference. Check both the displayed destination and the server's own configuration before sending repository content.

## Verification and troubleshooting

Automated adapter tests use mocked HTTP/SDK transports. Importer tests cover data parsing and secret separation; vault tests use a simulated OS encryptor. These tests establish the application's contract and failure handling, not universal provider access or model quality.

The native desktop verification record separately describes live model requests, UI flows, and persistence checks. Consult [VALIDATION.md](VALIDATION.md) for the current evidence and unverified integrations. A successful test proves only that the selected profile and model answered that synthetic request at that time.

If model discovery fails, inspect the error, verify endpoint/authentication, and enter the model manually where supported. If decryption fails, unlock the system key store or import the credential again. If a static bearer token expires, update it; the app does not silently switch provider or model.

Implementation references: [adapters](../electron/ai.cjs), [importer](../electron/ai-import.cjs), [vault](../electron/ai-vault.cjs), and [IPC contract](../API.md).
