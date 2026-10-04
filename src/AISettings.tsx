/* Copyright (C) 2026 Davide Leopardi
 * SPDX-License-Identifier: GPL-3.0-only */

import { useCallback, useEffect, useState } from "react";
import {
  X,
  Plus,
  Check,
  Trash2,
  Sparkles,
  Cloud,
  Server,
  ShieldCheck,
  KeyRound,
  Download,
  RefreshCw,
  FlaskConical,
  ArrowUpRight,
  LoaderCircle,
  AlertTriangle,
  Settings2,
  FolderInput,
  CheckCircle2,
} from "lucide-react";
import "./ai-settings.css";
import { useI18n } from "./i18n";
type Translate = (
  key: string,
  params?: Record<string, string | number>,
) => string;
export type AIProvider =
  | "openai"
  | "azure"
  | "vertex"
  | "google"
  | "litellm"
  | "bedrock"
  | "ollama"
  | "compatible";
export interface AIProfile {
  id: string;
  name: string;
  provider: AIProvider;
  baseUrl?: string;
  model: string;
  apiVersion?: string;
  project?: string;
  location?: string;
  region?: string;
  awsProfile?: string;
  authMode?: string;
  hasCredential: boolean;
}
export interface AIConfiguration {
  profiles: AIProfile[];
  activeProfileId: string | null;
}
export interface AICredentials {
  apiKey?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  serviceAccount?: string;
  bearerToken?: string;
}
export const AIProviders: {
  id: AIProvider;
  name: string;
  description: string;
  endpoint?: string;
  authMode?: string;
}[] = [
  {
    id: "openai",
    name: "OpenAI",
    description: "API OpenAI",
    endpoint: "https://api.openai.com/v1",
    authMode: "apiKey",
  },
  {
    id: "azure",
    name: "Azure OpenAI",
    description: "Risorsa e deployment Azure",
    authMode: "apiKey",
  },
  {
    id: "vertex",
    name: "Vertex AI",
    description: "Progetto Google Cloud",
    authMode: "adc",
  },
  {
    id: "google",
    name: "Google AI Studio",
    description: "Gemini API",
    authMode: "apiKey",
  },
  {
    id: "litellm",
    name: "LiteLLM",
    description: "Gateway multi-provider",
    endpoint: "http://127.0.0.1:4000/v1",
    authMode: "apiKey",
  },
  {
    id: "bedrock",
    name: "Amazon Bedrock",
    description: "API key o credenziali AWS",
    authMode: "apiKey",
  },
  {
    id: "ollama",
    name: "Ollama",
    description: "Modelli sul tuo computer",
    endpoint: "http://127.0.0.1:11434",
    authMode: "none",
  },
  {
    id: "compatible",
    name: "OpenAI compatibile",
    description: "LM Studio, vLLM, gateway",
    endpoint: "http://127.0.0.1:1234/v1",
    authMode: "none",
  },
];
export function isLocalAIProfile(
  profile: Pick<AIProfile, "provider" | "baseUrl">,
) {
  if (!["ollama", "compatible"].includes(profile.provider)) return false;
  try {
    const url = new URL(
      profile.baseUrl ||
        AIProviders.find((p) => p.id === profile.provider)?.endpoint ||
        "",
    );
    return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}
export function aiDestination(profile: AIProfile, t: Translate) {
  return isLocalAIProfile(profile)
    ? t("Endpoint locale sul tuo computer")
    : profile.provider === "litellm"
      ? t("Gateway LiteLLM: il modello può usare un servizio remoto")
      : t("Servizio {provider}", {
          provider: t(
            AIProviders.find((p) => p.id === profile.provider)?.name ||
              profile.provider,
          ),
        });
}
const freshProfile = (): AIProfile => ({
  id: crypto.randomUUID(),
  name: "",
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  model: "",
  authMode: "apiKey",
  hasCredential: false,
});
export default function AISettings({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { t, formatNumber } = useI18n();
  const [config, setConfig] = useState<AIConfiguration>({
      profiles: [],
      activeProfileId: null,
    }),
    [draft, setDraft] = useState<AIProfile | null>(null),
    [credentials, setCredentials] = useState<AICredentials>({}),
    [models, setModels] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState<{
      key: string;
      params?: Record<string, string | number>;
      raw?: boolean;
    } | null>(null),
    [test, setTest] = useState<{
      text: string;
      model: string;
      profileId: string;
      durationMs: number;
    } | null>(null),
    [removeId, setRemoveId] = useState<string | null>(null);
  const invoke = <T,>(method: string, payload?: Record<string, unknown>) =>
    window.branchline.invoke<T>(method, payload);
  const saved = !!draft && config.profiles.some((p) => p.id === draft.id),
    dirty =
      !!draft &&
      (!saved ||
        JSON.stringify(draft) !==
          JSON.stringify(config.profiles.find((p) => p.id === draft.id)) ||
        Object.values(credentials).some(Boolean));
  const load = useCallback(async (preferred?: string) => {
    const data = await window.branchline.invoke<AIConfiguration>("ai.settings");
    setConfig(data);
    const chosen =
      data.profiles.find((p) => p.id === preferred) ||
      data.profiles.find((p) => p.id === data.activeProfileId) ||
      data.profiles[0];
    setDraft(chosen ? { ...chosen } : null);
    setCredentials({});
    setModels([]);
    return data;
  }, []);
  useEffect(() => {
    let active = true;
    window.branchline
      .invoke<AIConfiguration>("ai.settings")
      .then((data) => {
        if (!active) return;
        setConfig(data);
        const p =
          data.profiles.find((p) => p.id === data.activeProfileId) ||
          data.profiles[0];
        setDraft(p ? { ...p } : null);
      })
      .catch((e) => active && setError(String(e.message || e)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);
  async function task(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message || String(e));
    } finally {
      setBusy(false);
    }
  }
  function choose(profile: AIProfile) {
    setDraft({ ...profile });
    setCredentials({});
    setModels([]);
    setTest(null);
    setError("");
    setNotice(null);
    setRemoveId(null);
  }
  function setProvider(provider: AIProvider) {
    if (!draft || saved) return;
    const info = AIProviders.find((p) => p.id === provider)!;
    setDraft({
      id: draft.id,
      name: draft.name,
      provider,
      baseUrl: info.endpoint,
      model: "",
      authMode: info.authMode,
      hasCredential: false,
    });
    setCredentials({});
    setModels([]);
    setTest(null);
  }
  function change(key: keyof AIProfile, value: string) {
    if (draft) setDraft({ ...draft, [key]: value });
    setTest(null);
  }
  function secret(
    key: keyof AICredentials,
    label: string,
    placeholder = "Lascia vuoto per conservare il valore salvato",
  ) {
    return (
      <label className="ai-field ai-secret">
        <span>
          <KeyRound size={12} />
          {t(label)}
        </span>
        <input
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          aria-label={t(label)}
          disabled={busy}
          value={credentials[key] || ""}
          onChange={(e) =>
            setCredentials({ ...credentials, [key]: e.target.value })
          }
          placeholder={
            draft?.hasCredential
              ? t(placeholder)
              : t("Inserisci la credenziale")
          }
        />
      </label>
    );
  }
  async function save() {
    if (!draft) return;
    const profile = {
      ...draft,
      name: draft.name.trim(),
      model: draft.model.trim(),
    };
    if (!profile.name) throw new Error("Assegna un nome al profilo.");
    const values = Object.fromEntries(
      Object.entries(credentials).filter(([, value]) => value),
    );
    await invoke("ai.save", {
      profile,
      ...(Object.keys(values).length ? { credentials: values } : {}),
    });
    await load(profile.id);
    setTest(null);
    setNotice({
      key: "Profilo salvato. Nessuna richiesta è stata inviata al modello.",
    });
    onSaved?.();
  }
  const authOptions =
    draft?.provider === "vertex"
      ? [
          { id: "adc", label: "ADC locale" },
          { id: "serviceAccount", label: "Service account" },
          { id: "bearer", label: "Bearer token" },
        ]
      : draft?.provider === "bedrock"
        ? [
            { id: "apiKey", label: "API key Bedrock" },
            { id: "aws", label: "Chiavi AWS" },
            { id: "awsProfile", label: "Profilo AWS" },
          ]
        : draft?.provider === "azure"
          ? [
              { id: "apiKey", label: "API key" },
              { id: "bearer", label: "Token Entra" },
            ]
          : draft?.provider === "compatible"
            ? [
                { id: "none", label: "Nessuna" },
                { id: "apiKey", label: "API key" },
                { id: "bearer", label: "Bearer token" },
              ]
            : [];
  const usesAPIKey =
    (draft && ["openai", "google", "litellm"].includes(draft.provider)) ||
    (draft &&
      ["azure", "bedrock", "compatible"].includes(draft.provider) &&
      draft.authMode === "apiKey");
  return (
    <div className="ai-settings-backdrop">
      <section
        className="ai-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("Profili e modelli AI")}
      >
        <header>
          <div className="ai-settings-symbol">
            <Sparkles size={23} />
          </div>
          <div>
            <div className="ai-eyebrow">BRANCHLINE / AI</div>
            <h2>{t("Il tuo provider. Il tuo modello.")}</h2>
            <p>
              {t(
                "Profili locali e cloud, con credenziali conservate sul computer.",
              )}
            </p>
          </div>
          <button
            className="ai-icon-button"
            disabled={busy}
            onClick={onClose}
            aria-label={t("Chiudi impostazioni AI")}
          >
            <X size={20} />
          </button>
        </header>
        <div className="ai-settings-workspace">
          <aside className="ai-profile-sidebar">
            <div className="ai-sidebar-heading">
              <span>{t("PROFILI")}</span>
              <button
                aria-label={t("Aggiungi profilo AI")}
                disabled={busy}
                onClick={() => {
                  setDraft(freshProfile());
                  setCredentials({});
                  setModels([]);
                  setTest(null);
                  setError("");
                  setNotice(null);
                  setRemoveId(null);
                }}
              >
                <Plus size={15} />
              </button>
            </div>
            {loading ? (
              <div className="ai-profile-empty">
                <LoaderCircle size={18} className="spin" />
                {t("Caricamento…")}
              </div>
            ) : config.profiles.length ? (
              config.profiles.map((p) => (
                <button
                  className={`ai-profile-item ${draft?.id === p.id ? "selected" : ""}`}
                  key={p.id}
                  disabled={busy}
                  onClick={() => choose(p)}
                >
                  {isLocalAIProfile(p) ? (
                    <Server size={16} />
                  ) : (
                    <Cloud size={16} />
                  )}
                  <div>
                    <strong>{p.name}</strong>
                    <span>
                      {t(
                        AIProviders.find((x) => x.id === p.provider)?.name ||
                          p.provider,
                      )}
                      {p.model && ` · ${p.model}`}
                    </span>
                  </div>
                  {p.id === config.activeProfileId && (
                    <CheckCircle2 size={13} />
                  )}
                </button>
              ))
            ) : (
              <div className="ai-profile-empty">
                {t("Aggiungi un profilo o importa una configurazione.")}
              </div>
            )}
            {draft && !saved && (
              <div className="ai-profile-draft">
                <Plus size={13} />
                <span>{t("Nuovo profilo")}</span>
              </div>
            )}
            <div className="ai-import-actions">
              <button
                disabled={busy}
                onClick={() =>
                  task(async () => {
                    const imported =
                      await invoke<AIConfiguration>("ai.importHarness");
                    await load();
                    onSaved?.();
                    setNotice({
                      key:
                        JSON.stringify(imported) === JSON.stringify(config)
                          ? "Importazione annullata o configurazione invariata."
                          : "Profili importati dalla configurazione locale. Nessuna richiesta ai modelli eseguita.",
                    });
                  })
                }
              >
                <FolderInput size={14} />
                {t("Importa dal harness")}
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  task(async () => {
                    const imported = await invoke<AIConfiguration>("ai.import");
                    await load();
                    onSaved?.();
                    setNotice({
                      key:
                        JSON.stringify(imported) === JSON.stringify(config)
                          ? "Importazione annullata o configurazione invariata."
                          : "Importazione completata. Verifica provider e modelli prima di usarli.",
                    });
                  })
                }
              >
                <Download size={14} />
                {t("Importa .env / JSON")}
              </button>
              <p>
                {t(
                  "Le credenziali importate restano nascoste nell’interfaccia.",
                )}
              </p>
            </div>
          </aside>
          <main className="ai-profile-main">
            {draft ? (
              <>
                <div className="ai-profile-heading">
                  <div>
                    <span className="ai-section-eyebrow">
                      {saved ? t("CONFIGURAZIONE PROFILO") : t("NUOVO PROFILO")}
                    </span>
                    <h3>{draft.name || t("Configura una connessione")}</h3>
                  </div>
                  {draft.id === config.activeProfileId ? (
                    <span className="ai-active-badge">
                      <Check size={12} />
                      {t("Attivo")}
                    </span>
                  ) : saved ? (
                    <span className="ai-profile-badge">{t("Salvato")}</span>
                  ) : null}
                </div>
                <label className="ai-field">
                  <span>{t("Nome del profilo")}</span>
                  <input
                    autoFocus={!saved}
                    value={draft.name}
                    placeholder={t("Es. Ollama personale, Azure aziendale…")}
                    onChange={(e) => change("name", e.target.value)}
                    disabled={busy}
                  />
                </label>
                <div className="ai-field-label">
                  {t("Provider")}
                  {saved && (
                    <small>
                      {t("Per cambiare provider, crea un nuovo profilo.")}
                    </small>
                  )}
                </div>
                <div
                  className="ai-provider-grid"
                  role="group"
                  aria-label={t("Provider AI")}
                >
                  {AIProviders.map((p) => (
                    <button
                      key={p.id}
                      className={draft.provider === p.id ? "selected" : ""}
                      disabled={busy || (saved && draft.provider !== p.id)}
                      aria-pressed={draft.provider === p.id}
                      onClick={() => setProvider(p.id)}
                    >
                      {p.id === "ollama" || p.id === "compatible" ? (
                        <Server size={14} />
                      ) : (
                        <Cloud size={14} />
                      )}
                      <span>{t(p.name)}</span>
                      {draft.provider === p.id && <Check size={12} />}
                    </button>
                  ))}
                </div>
                <div className="ai-form-grid">
                  {!["vertex", "bedrock"].includes(draft.provider) && (
                    <label className="ai-field ai-full-width">
                      <span>
                        {draft.provider === "azure"
                          ? t("Endpoint della risorsa Azure")
                          : t("URL del servizio")}
                        {draft.provider === "google" && (
                          <small>{t("Facoltativo")}</small>
                        )}
                      </span>
                      <input
                        value={draft.baseUrl || ""}
                        placeholder={
                          AIProviders.find((p) => p.id === draft.provider)
                            ?.endpoint ||
                          (draft.provider === "azure"
                            ? "https://risorsa.openai.azure.com"
                            : t("Endpoint predefinito del provider"))
                        }
                        onChange={(e) => change("baseUrl", e.target.value)}
                        spellCheck={false}
                        disabled={busy}
                      />
                    </label>
                  )}
                  {draft.provider === "azure" && (
                    <label className="ai-field ai-full-width">
                      <span>
                        {t("Versione API")}
                        <small>{t("Facoltativa · vuota usa v1")}</small>
                      </span>
                      <input
                        value={draft.apiVersion || ""}
                        placeholder={t("Vuota per API v1")}
                        onChange={(e) => change("apiVersion", e.target.value)}
                        disabled={busy}
                      />
                    </label>
                  )}
                  {draft.provider === "vertex" && (
                    <>
                      <label className="ai-field">
                        <span>{t("Progetto Google Cloud")}</span>
                        <input
                          value={draft.project || ""}
                          placeholder="project-id"
                          onChange={(e) => change("project", e.target.value)}
                          disabled={busy}
                        />
                      </label>
                      <label className="ai-field">
                        <span>{t("Location")}</span>
                        <input
                          value={draft.location || ""}
                          placeholder={t("global oppure una regione")}
                          onChange={(e) => change("location", e.target.value)}
                          disabled={busy}
                        />
                      </label>
                    </>
                  )}
                  {draft.provider === "bedrock" && (
                    <label className="ai-field ai-full-width">
                      <span>{t("Regione AWS")}</span>
                      <input
                        value={draft.region || ""}
                        placeholder="eu-west-1"
                        onChange={(e) => change("region", e.target.value)}
                        disabled={busy}
                      />
                    </label>
                  )}
                  {authOptions.length > 0 && (
                    <div className="ai-full-width">
                      <div className="ai-field-label">
                        {t("Autenticazione")}
                      </div>
                      <div
                        className="ai-auth-options"
                        role="group"
                        aria-label={t("Metodo di autenticazione")}
                      >
                        {authOptions.map((a) => (
                          <button
                            key={a.id}
                            aria-pressed={(draft.authMode || "none") === a.id}
                            className={
                              (draft.authMode || "none") === a.id
                                ? "selected"
                                : ""
                            }
                            disabled={busy}
                            onClick={() => {
                              change("authMode", a.id);
                              setCredentials({});
                            }}
                          >
                            {t(a.label)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {usesAPIKey && (
                    <div className="ai-full-width">
                      {secret(
                        "apiKey",
                        draft.provider === "bedrock"
                          ? "API key Bedrock"
                          : "API key",
                      )}
                    </div>
                  )}
                  {["azure", "vertex", "compatible"].includes(draft.provider) &&
                    draft.authMode === "bearer" && (
                      <div className="ai-full-width">
                        {secret("bearerToken", "Bearer token")}
                      </div>
                    )}
                  {draft.provider === "vertex" &&
                    draft.authMode === "serviceAccount" && (
                      <div className="ai-full-width">
                        {secret("serviceAccount", "JSON del service account")}
                      </div>
                    )}
                  {draft.provider === "vertex" && draft.authMode === "adc" && (
                    <p className="ai-auth-note ai-full-width">
                      <ShieldCheck size={13} />
                      {t(
                        "Usa Application Default Credentials configurate sul computer.",
                      )}
                    </p>
                  )}
                  {draft.provider === "bedrock" && draft.authMode === "aws" && (
                    <>
                      <div className="ai-full-width">
                        {secret("accessKeyId", "AWS Access Key ID")}
                      </div>
                      <div className="ai-full-width">
                        {secret("secretAccessKey", "AWS Secret Access Key")}
                      </div>
                      <div className="ai-full-width">
                        {secret(
                          "sessionToken",
                          "AWS Session Token (facoltativo)",
                        )}
                      </div>
                    </>
                  )}
                  {draft.provider === "bedrock" &&
                    draft.authMode === "awsProfile" && (
                      <label className="ai-field ai-full-width">
                        <span>{t("Profilo AWS locale")}</span>
                        <input
                          value={draft.awsProfile || ""}
                          placeholder="default"
                          onChange={(e) => change("awsProfile", e.target.value)}
                          disabled={busy}
                        />
                      </label>
                    )}
                </div>
                <div className="ai-credential-status">
                  <ShieldCheck size={12} />
                  {draft.provider === "compatible" &&
                  (!draft.authMode || draft.authMode === "none")
                    ? t(
                        "Endpoint configurato senza autenticazione. Le eventuali credenziali salvate non vengono inviate.",
                      )
                    : draft.hasCredential
                      ? t(
                          "Credenziale presente. Il valore salvato non viene mostrato.",
                        )
                      : draft.provider === "ollama"
                        ? t(
                            "Questo profilo Ollama usa un endpoint senza credenziali.",
                          )
                        : draft.authMode === "adc" ||
                            draft.authMode === "awsProfile"
                          ? t(
                              "Accesso tramite credenziali configurate sul computer.",
                            )
                          : t(
                              "Nessuna credenziale salvata per questo profilo.",
                            )}
                </div>
                <div className="ai-model-heading">
                  <span className="ai-field-label">
                    {draft.provider === "azure"
                      ? t("Deployment / modello")
                      : t("Modello")}
                  </span>
                  <button
                    disabled={busy || !saved || dirty}
                    title={
                      dirty
                        ? t("Salva il profilo prima di rilevare i modelli")
                        : t("Interroga il provider per elencare i modelli")
                    }
                    onClick={() =>
                      task(async () => {
                        const r = await invoke<{
                          models: string[];
                          message: string;
                        }>("ai.models", { profileId: draft.id });
                        setModels(r.models);
                        setNotice(
                          r.message
                            ? { key: r.message, raw: true }
                            : {
                                key: "{count} modelli disponibili. Nessuna inferenza eseguita.",
                                params: {
                                  count: r.models.length,
                                },
                              },
                        );
                      })
                    }
                  >
                    <RefreshCw size={12} />
                    {t("Rileva modelli")}
                  </button>
                </div>
                <input
                  className="ai-model-input"
                  aria-label={t("Modello del profilo AI")}
                  value={draft.model}
                  list="ai-settings-models"
                  placeholder={
                    draft.provider === "azure"
                      ? t("Nome deployment Azure")
                      : t("Scegli un modello rilevato o inserisci un ID")
                  }
                  onChange={(e) => change("model", e.target.value)}
                  disabled={busy}
                />
                <datalist id="ai-settings-models">
                  {models.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
                <p className="ai-model-note">
                  {t(
                    "Puoi inserire manualmente il modello anche quando il provider non offre un elenco.",
                  )}
                </p>
                <div className="ai-data-destination">
                  <span
                    className={`ai-destination-icon ${isLocalAIProfile(draft) ? "local" : ""}`}
                  >
                    {isLocalAIProfile(draft) ? (
                      <Server size={17} />
                    ) : (
                      <Cloud size={17} />
                    )}
                  </span>
                  <div>
                    <strong>{aiDestination(draft, t)}</strong>
                    <p>
                      {isLocalAIProfile(draft)
                        ? t(
                            "I diff vengono inviati all’endpoint locale configurato.",
                          )
                        : t(
                            "Quando generi un suggerimento, il diff viene inviato a questo provider.",
                          )}{" "}
                      {t(
                        "Il test usa una richiesta sintetica e non include file del repository.",
                      )}
                    </p>
                  </div>
                </div>
                <div className="ai-profile-actions">
                  <button
                    className="ai-save-button"
                    disabled={busy || !draft.name.trim()}
                    onClick={() => task(save)}
                  >
                    {busy ? (
                      <LoaderCircle size={14} className="spin" />
                    ) : (
                      <Check size={14} />
                    )}
                    {t("Salva profilo")}
                  </button>
                  <button
                    disabled={busy || !saved || dirty || !draft.model.trim()}
                    onClick={() =>
                      task(async () => {
                        await invoke("ai.activate", {
                          id: draft.id,
                          model: draft.model,
                        });
                        await load(draft.id);
                        onSaved?.();
                        setNotice({
                          key: "Profilo e modello attivi per le nuove richieste.",
                        });
                      })
                    }
                  >
                    <Sparkles size={14} />
                    {t("Usa come attivo")}
                  </button>
                  <button
                    disabled={busy || !saved || dirty || !draft.model.trim()}
                    onClick={() =>
                      task(async () => {
                        const r = await invoke<{
                          text: string;
                          model: string;
                          profileId: string;
                          durationMs: number;
                        }>("ai.test", {
                          profileId: draft.id,
                          model: draft.model,
                        });
                        setTest(r);
                        setNotice({
                          key: "Test completato con una richiesta sintetica.",
                        });
                      })
                    }
                  >
                    <FlaskConical size={14} />
                    {t("Test connessione")}
                  </button>
                  {saved && (
                    <button
                      className="ai-delete-button"
                      aria-label={t("Elimina profilo {name}", {
                        name: draft.name,
                      })}
                      disabled={busy}
                      onClick={() => setRemoveId(draft.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
                {dirty && saved && (
                  <p className="ai-unsaved-note">
                    {t(
                      "Salva le modifiche prima di rilevare modelli, attivare il profilo o eseguire il test.",
                    )}
                  </p>
                )}
                {removeId === draft.id && (
                  <div className="ai-delete-confirm">
                    <AlertTriangle size={16} />
                    <div>
                      <strong>
                        {t("Eliminare “{name}”?", { name: draft.name })}
                      </strong>
                      <p>
                        {t(
                          "Verranno rimossi il profilo e le sue credenziali salvate.",
                        )}
                      </p>
                    </div>
                    <button disabled={busy} onClick={() => setRemoveId(null)}>
                      {t("Annulla")}
                    </button>
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={() =>
                        task(async () => {
                          await invoke("ai.remove", { id: removeId });
                          setRemoveId(null);
                          await load();
                          onSaved?.();
                          setNotice({ key: "Profilo eliminato." });
                        })
                      }
                    >
                      {t("Elimina")}
                    </button>
                  </div>
                )}
                {test && (
                  <div className="ai-test-result">
                    <header>
                      <CheckCircle2 size={13} />
                      <strong>{t("Risposta del test")}</strong>
                      <span>
                        {t("{model} · {seconds} s", {
                          model: test.model,
                          seconds: formatNumber(test.durationMs / 1000, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          }),
                        })}
                      </span>
                    </header>
                    <pre>{test.text}</pre>
                  </div>
                )}
              </>
            ) : (
              <div className="ai-settings-empty">
                <div>
                  <Sparkles size={34} />
                </div>
                <h3>{t("Scegli dove eseguire i tuoi modelli")}</h3>
                <p>
                  {t(
                    "Aggiungi un profilo per il computer locale, un provider cloud o un gateway aziendale.",
                  )}
                </p>
                <button
                  disabled={busy || loading}
                  className="ai-save-button"
                  onClick={() => {
                    setDraft(freshProfile());
                    setCredentials({});
                  }}
                >
                  <Plus size={15} />
                  {t("Aggiungi il primo profilo")}
                </button>
              </div>
            )}
            {error && (
              <div className="ai-settings-error" role="alert">
                <AlertTriangle size={15} />
                <span>
                  {error === "Assegna un nome al profilo."
                    ? t("Assegna un nome al profilo.")
                    : error}
                </span>
              </div>
            )}
            {notice && (
              <div className="ai-settings-notice" role="status">
                <CheckCircle2 size={15} />
                <span>
                  {notice.raw
                    ? notice.key
                    : t(notice.key, {
                        ...notice.params,
                        ...(typeof notice.params?.count === "number"
                          ? { count: formatNumber(notice.params.count) }
                          : {}),
                      })}
                </span>
              </div>
            )}
          </main>
        </div>
        <footer>
          <span>
            <ShieldCheck size={13} />
            {t("Nessuna richiesta al modello viene eseguita all’apertura.")}
          </span>
          <button disabled={busy} onClick={onClose}>
            {t("Chiudi")}
          </button>
        </footer>
      </section>
    </div>
  );
}
