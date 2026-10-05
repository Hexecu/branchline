/* Copyright (C) 2026 Davide Leopardi
 * SPDX-License-Identifier: GPL-3.0-only */

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Cloud,
  ExternalLink,
  GitPullRequest,
  Inbox,
  KeyRound,
  Link2,
  LoaderCircle,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import type { Snapshot } from "./types";
import "./hosting-settings.css";
import { useI18n } from "./i18n";

export type HostingProvider =
  | "github"
  | "gitlab"
  | "bitbucket-cloud"
  | "bitbucket-server"
  | "azure-devops"
  | "gitea"
  | "forgejo";
export interface HostingProfile {
  id: string;
  name: string;
  provider: HostingProvider;
  baseUrl: string;
  username?: string;
  apiVersion?: string;
  authMode?: "none" | "token" | "bearer" | "basic" | "gh";
  hasCredential: boolean;
}
interface HostingConfiguration {
  profiles: HostingProfile[];
  bindings: { repo: string; remote: string; profileId: string | null }[];
}
interface HostingRemote {
  name: string;
  url: string;
  host: string;
  repository: string;
  provider?: HostingProvider;
  supported: boolean;
}
interface HostingStatus {
  available: boolean;
  authenticated: boolean;
  message: string;
  provider?: HostingProvider;
  host?: string;
  remote?: string;
  repository?: string;
  profileId?: string | null;
  capabilities?: { prs: boolean; issues: boolean };
  remotes?: HostingRemote[];
}
interface HostingItem {
  number: number | string;
  id: number | string;
  title: string;
  state: string;
  author?: { login: string };
  url: string;
  updatedAt?: string;
  isDraft?: boolean;
}
export const hostingProviders: {
  id: HostingProvider;
  name: string;
  baseUrl: string;
  modes: NonNullable<HostingProfile["authMode"]>[];
}[] = [
  {
    id: "github",
    name: "GitHub",
    baseUrl: "https://github.com",
    modes: ["token", "gh", "none"],
  },
  {
    id: "gitlab",
    name: "GitLab",
    baseUrl: "https://gitlab.com",
    modes: ["token", "bearer", "none"],
  },
  {
    id: "bitbucket-cloud",
    name: "Bitbucket Cloud",
    baseUrl: "https://bitbucket.org",
    modes: ["basic", "bearer", "none"],
  },
  {
    id: "bitbucket-server",
    name: "Bitbucket Server / Data Center",
    baseUrl: "",
    modes: ["token", "basic", "bearer", "none"],
  },
  {
    id: "azure-devops",
    name: "Azure DevOps",
    baseUrl: "",
    modes: ["basic", "bearer", "none"],
  },
  {
    id: "gitea",
    name: "Gitea",
    baseUrl: "",
    modes: ["token", "bearer", "none"],
  },
  {
    id: "forgejo",
    name: "Forgejo",
    baseUrl: "",
    modes: ["token", "bearer", "none"],
  },
];
const authNames = {
  none: "Accesso pubblico",
  token: "Token / API key",
  bearer: "Bearer token",
  basic: "Utente + token",
  gh: "GitHub CLI",
};
const invoke = <T,>(method: string, payload?: Record<string, unknown>) =>
  window.branchline.invoke<T>(method, payload);
const describeError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const emptyConfiguration = (): HostingConfiguration => ({
  profiles: [],
  bindings: [],
});
const freshProfile = (): HostingProfile => ({
  id: crypto.randomUUID(),
  name: "",
  provider: "github",
  baseUrl: "https://github.com",
  authMode: "token",
  hasCredential: false,
});

export default function HostingSettings({
  snapshot,
  onClose,
  onSaved,
}: {
  snapshot: Snapshot | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { t } = useI18n();
  const [configuration, setConfiguration] =
      useState<HostingConfiguration>(emptyConfiguration),
    [draft, setDraft] = useState<HostingProfile | null>(null),
    [credential, setCredential] = useState(""),
    [remote, setRemote] = useState(snapshot?.remotes[0]?.name || ""),
    [bindingProfile, setBindingProfile] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState<{
      key: string;
      params?: Record<string, string | number>;
    } | null>(null),
    [test, setTest] = useState<HostingStatus | null>(null),
    [removeId, setRemoveId] = useState<string | null>(null),
    [discardTarget, setDiscardTarget] = useState<
      string | "new" | "close" | null
    >(null);
  const active = useRef(true);
  const savedProfile = configuration.profiles.find(
    (profile) => profile.id === draft?.id,
  );
  const dirty =
    !!draft &&
    (!savedProfile ||
      JSON.stringify(draft) !== JSON.stringify(savedProfile) ||
      !!credential);
  useEffect(() => {
    active.current = true;
    invoke<HostingConfiguration>("provider.settings")
      .then((data) => {
        if (!active.current) return;
        setConfiguration(data);
        const bound = data.bindings.find(
          (binding) =>
            binding.repo === snapshot?.path && binding.remote === remote,
        );
        setBindingProfile(bound?.profileId || null);
        const chosen =
          data.profiles.find((profile) => profile.id === bound?.profileId) ||
          data.profiles[0];
        setDraft(chosen ? { ...chosen } : null);
      })
      .catch((e) => active.current && setError(describeError(e)))
      .finally(() => active.current && setLoading(false));
    return () => {
      active.current = false;
    };
  }, [snapshot?.path]);
  const selectDraft = (target: string | "new" | "close") => {
    if (target === "close") {
      onClose();
      return;
    }
    setDraft(
      target === "new"
        ? freshProfile()
        : {
            ...configuration.profiles.find((profile) => profile.id === target)!,
          },
    );
    setCredential("");
    setError("");
    setNotice(null);
    setTest(null);
    setRemoveId(null);
  };
  const requestSelect = (target: string | "new" | "close") => {
    if (busy) return;
    if (dirty) setDiscardTarget(target);
    else selectDraft(target);
  };
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (removeId) setRemoveId(null);
      else if (discardTarget) setDiscardTarget(null);
      else requestSelect("close");
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });
  const update = (changes: Partial<HostingProfile>) => {
    if (!draft) return;
    setDraft({ ...draft, ...changes });
    setError("");
    setNotice(null);
    setTest(null);
  };
  const save = async () => {
    if (!draft || !draft.name.trim() || !draft.baseUrl.trim()) return;
    setBusy(true);
    setError("");
    setNotice(null);
    try {
      const credentials = credential
        ? {
            [draft.authMode === "bearer" ? "bearerToken" : "apiKey"]:
              credential,
          }
        : undefined;
      const data = await invoke<HostingConfiguration>("provider.save", {
        profile: {
          ...draft,
          name: draft.name.trim(),
          baseUrl: draft.baseUrl.trim(),
        },
        ...(credentials ? { credentials } : {}),
      });
      if (!active.current) return;
      setConfiguration(data);
      setDraft(
        data.profiles.find((profile) => profile.id === draft.id) || null,
      );
      setCredential("");
      setTest(null);
      setNotice({
        key: "Profilo salvato. Le credenziali restano cifrate sul computer.",
      });
      onSaved?.();
    } catch (e) {
      if (active.current) setError(describeError(e));
    } finally {
      if (active.current) setBusy(false);
    }
  };
  const remove = async () => {
    if (!removeId) return;
    setBusy(true);
    setError("");
    try {
      const data = await invoke<HostingConfiguration>("provider.delete", {
        id: removeId,
      });
      if (!active.current) return;
      setConfiguration(data);
      setDraft(data.profiles[0] || null);
      setCredential("");
      setRemoveId(null);
      setTest(null);
      if (bindingProfile === removeId) setBindingProfile(null);
      setNotice({
        key: "Profilo e credenziali eliminati. I remote Git non sono stati modificati.",
      });
      onSaved?.();
    } catch (e) {
      if (active.current) setError(describeError(e));
    } finally {
      if (active.current) setBusy(false);
    }
  };
  const bind = async () => {
    if (!snapshot || !remote) return;
    setBusy(true);
    setError("");
    setNotice(null);
    try {
      const data = await invoke<HostingConfiguration>("provider.bind", {
        path: snapshot.path,
        remote,
        profileId: bindingProfile,
      });
      if (!active.current) return;
      setConfiguration(data);
      setNotice({
        key: "Associazione salvata per {name} · {remote}. Il remote Git rimane invariato.",
        params: { name: snapshot.name, remote },
      });
      onSaved?.();
    } catch (e) {
      if (active.current) setError(describeError(e));
    } finally {
      if (active.current) setBusy(false);
    }
  };
  const testConnection = async () => {
    if (!snapshot || !remote || !draft || dirty) return;
    setBusy(true);
    setError("");
    setNotice(null);
    setTest(null);
    try {
      const result = await invoke<HostingStatus>("provider.test", {
        path: snapshot.path,
        remote,
        profileId: draft.id,
      });
      if (active.current) setTest(result);
    } catch (e) {
      if (active.current) setError(describeError(e));
    } finally {
      if (active.current) setBusy(false);
    }
  };
  const provider = hostingProviders.find((item) => item.id === draft?.provider);
  const selectRemote = (name: string) => {
    setRemote(name);
    setTest(null);
    setBindingProfile(
      configuration.bindings.find(
        (binding) => binding.repo === snapshot?.path && binding.remote === name,
      )?.profileId || null,
    );
  };
  return (
    <div
      className="hosting-backdrop"
      onMouseDown={() => requestSelect("close")}
    >
      <section
        className="hosting-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hosting-settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <span className="hosting-symbol">
            <Server size={25} />
          </span>
          <div>
            <div className="eyebrow">{t("REPOSITORY E ACCOUNT")}</div>
            <h2 id="hosting-settings-title">{t("Profili hosting")}</h2>
            <p>
              {t("Servizi pubblici, server aziendali e credenziali protette.")}
            </p>
          </div>
          <button
            className="icon-button"
            aria-label={t("Chiudi profili hosting")}
            onClick={() => requestSelect("close")}
            disabled={busy}
          >
            <X size={19} />
          </button>
        </header>
        <div className="hosting-workspace">
          <aside className="hosting-profile-list">
            <div className="hosting-list-heading">
              <span>{t("PROFILI")}</span>
              <button
                onClick={() => requestSelect("new")}
                disabled={busy || loading}
                aria-label={t("Aggiungi profilo hosting")}
              >
                <Plus size={17} />
              </button>
            </div>
            {configuration.profiles.map((profile) => (
              <button
                key={profile.id}
                className={`hosting-profile ${draft?.id === profile.id ? "active" : ""}`}
                onClick={() => requestSelect(profile.id)}
                disabled={busy}
              >
                <Cloud size={16} />
                <span>
                  <strong>{profile.name}</strong>
                  <small>
                    {hostingProviders.find(
                      (item) => item.id === profile.provider,
                    )?.name || profile.provider}
                  </small>
                </span>
                {profile.hasCredential && <ShieldCheck size={13} />}
              </button>
            ))}
            {!configuration.profiles.length && !loading && (
              <p className="hosting-list-note">
                {t(
                  "Aggiungi un profilo per il tuo account o server. GitHub può usare anche GitHub CLI.",
                )}
              </p>
            )}
            <div className="hosting-privacy-note">
              <ShieldCheck size={16} />
              <p>
                {t(
                  "I profili contengono metadati. Le chiavi sono cifrate separatamente e non vengono restituite all’interfaccia.",
                )}
              </p>
            </div>
          </aside>
          <main className="hosting-editor">
            {loading ? (
              <div className="loading-state">
                <LoaderCircle className="spin" size={22} />
                {t("Caricamento profili…")}
              </div>
            ) : draft ? (
              <>
                <div className="hosting-editor-heading">
                  <div>
                    <h3>{draft.name || t("Nuovo profilo")}</h3>
                    <p>
                      {dirty ? t("Modifiche da salvare") : t("Profilo salvato")}
                    </p>
                  </div>
                  {savedProfile && (
                    <button
                      className="hosting-delete"
                      disabled={busy}
                      onClick={() => setRemoveId(draft.id)}
                    >
                      <Trash2 size={14} />
                      {t("Elimina")}
                    </button>
                  )}
                </div>
                <label className="hosting-field">
                  <span>{t("Nome del profilo")}</span>
                  <input
                    value={draft.name}
                    disabled={busy}
                    placeholder={t("Account personale o server aziendale")}
                    onChange={(event) => update({ name: event.target.value })}
                  />
                </label>
                <div className="hosting-field">
                  <span>{t("Provider")}</span>
                  <div className="hosting-provider-options">
                    {hostingProviders.map((item) => (
                      <button
                        key={item.id}
                        aria-pressed={draft.provider === item.id}
                        className={draft.provider === item.id ? "active" : ""}
                        disabled={busy}
                        onClick={() => {
                          update({
                            provider: item.id,
                            baseUrl: item.baseUrl,
                            authMode: item.modes[0],
                            username: "",
                          });
                          setCredential("");
                        }}
                      >
                        <Server size={14} />
                        {item.name}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="hosting-field">
                  <span>{t("URL server / organizzazione")}</span>
                  <input
                    value={draft.baseUrl}
                    disabled={busy}
                    placeholder={
                      draft.provider === "azure-devops"
                        ? "https://dev.azure.com/organization"
                        : "https://git.example.com"
                    }
                    onChange={(event) =>
                      update({ baseUrl: event.target.value })
                    }
                  />
                  <small>
                    {t(
                      "HTTPS, incluso l’eventuale prefisso del server. Gli endpoint API dipendono dal provider. Per Azure indica l’organizzazione o la collection.",
                    )}
                  </small>
                </label>
                {draft.provider === "azure-devops" && (
                  <label className="hosting-field">
                    <span>{t("Versione API Azure")}</span>
                    <input
                      value={draft.apiVersion || ""}
                      disabled={busy}
                      placeholder={t("Facoltativa · predefinita 7.1")}
                      onChange={(event) =>
                        update({ apiVersion: event.target.value })
                      }
                    />
                    <small>
                      {t(
                        "Per Azure DevOps Server usa una versione supportata dalla tua installazione.",
                      )}
                    </small>
                  </label>
                )}
                <div className="hosting-field">
                  <span>{t("Autenticazione")}</span>
                  <div className="hosting-auth-options">
                    {provider?.modes.map((mode) => (
                      <button
                        key={mode}
                        aria-pressed={draft.authMode === mode}
                        className={draft.authMode === mode ? "active" : ""}
                        disabled={busy}
                        onClick={() => {
                          update({ authMode: mode });
                          setCredential("");
                        }}
                      >
                        {t(authNames[mode])}
                      </button>
                    ))}
                  </div>
                </div>
                {draft.authMode === "none" ? (
                  <div className="hosting-inline-note">
                    <Cloud size={16} />
                    <p>
                      {t(
                        "Legge i repository pubblici senza inviare una credenziale. Il servizio può applicare limiti più stretti; i repository privati richiedono un’altra modalità.",
                      )}
                    </p>
                  </div>
                ) : draft.authMode === "gh" ? (
                  <div className="hosting-inline-note">
                    <Link2 size={16} />
                    <div>
                      <p>
                        {t(
                          "Usa l’accesso di GitHub CLI per il server selezionato. Configuralo dal terminale con il comando seguente. Branchline non legge né mostra i token salvati da gh.",
                        )}
                      </p>
                      <code>gh auth login --hostname HOST</code>
                    </div>
                  </div>
                ) : (
                  <>
                    {draft.authMode === "basic" && (
                      <label className="hosting-field">
                        <span>
                          {draft.provider === "bitbucket-cloud"
                            ? t("Email dell’account")
                            : t("Utente / account")}
                        </span>
                        <input
                          value={draft.username || ""}
                          disabled={busy}
                          autoComplete="off"
                          placeholder={
                            draft.provider === "azure-devops"
                              ? t("Facoltativo per PAT Azure")
                              : draft.provider === "bitbucket-cloud"
                                ? t("Email associata all’API token")
                                : t("Nome account richiesto dal server")
                          }
                          onChange={(event) =>
                            update({ username: event.target.value })
                          }
                        />
                      </label>
                    )}
                    <label className="hosting-field">
                      <span>
                        <KeyRound size={13} />
                        {draft.authMode === "bearer"
                          ? draft.provider === "bitbucket-cloud"
                            ? t("API token / OAuth / access token")
                            : t("Bearer token")
                          : draft.provider === "azure-devops"
                            ? t("Personal access token (PAT)")
                            : t("Token / API key")}
                        {draft.hasCredential && (
                          <em>{t("Credenziale già salvata")}</em>
                        )}
                      </span>
                      <input
                        type="password"
                        value={credential}
                        disabled={busy}
                        autoComplete="new-password"
                        spellCheck={false}
                        placeholder={
                          draft.hasCredential
                            ? t("Lascia vuoto per conservare la credenziale")
                            : t("Inserisci la credenziale del provider")
                        }
                        onChange={(event) => {
                          setCredential(event.target.value);
                          setTest(null);
                          setNotice(null);
                        }}
                      />
                      <small>
                        {t(
                          "Valore usato solo al salvataggio. I segreti salvati non vengono mostrati, nemmeno parzialmente.",
                        )}
                        {draft.provider === "bitbucket-cloud"
                          ? ` ${t("Usa API token, non app password.")}`
                          : ""}
                      </small>
                    </label>
                  </>
                )}
                <div className="hosting-save-row">
                  <button
                    className="hosting-primary"
                    disabled={
                      busy ||
                      !dirty ||
                      !draft.name.trim() ||
                      !draft.baseUrl.trim()
                    }
                    onClick={() => void save()}
                  >
                    <Check size={15} />
                    {t("Salva profilo")}
                  </button>
                  <button
                    disabled={busy || dirty || !snapshot || !remote}
                    title={
                      dirty
                        ? t("Salva il profilo prima del test")
                        : t(
                            "Richiesta in sola lettura al repository del remote selezionato",
                          )
                    }
                    onClick={() => void testConnection()}
                  >
                    <RefreshCw size={14} />
                    {t("Test connessione")}
                  </button>
                </div>
                {test && (
                  <div
                    className={`hosting-result ${test.authenticated ? "success" : ""}`}
                    role="status"
                  >
                    <ShieldCheck size={16} />
                    <div>
                      <strong>
                        {test.authenticated
                          ? t("Repository raggiungibile")
                          : t("Accesso da verificare")}
                      </strong>
                      <p>{test.message}</p>
                      <small>
                        {test.host} · {test.repository}
                      </small>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="hosting-empty">
                <Server size={34} />
                <h3>{t("Connetti il tuo hosting Git")}</h3>
                <p>
                  {t(
                    "Aggiungi un account pubblico o il tuo server aziendale. I comandi Git locali e i remote funzionano anche senza questi profili.",
                  )}
                </p>
                <button
                  className="hosting-primary"
                  onClick={() => requestSelect("new")}
                >
                  <Plus size={15} />
                  {t("Aggiungi profilo")}
                </button>
              </div>
            )}
            {snapshot && (
              <section className="hosting-binding">
                <div>
                  <h3>{t("Associa al repository")}</h3>
                  <p>
                    {t(
                      "{name} · seleziona il remote e il profilo. Non modifica gli URL Git.",
                      { name: snapshot.name },
                    )}
                  </p>
                </div>
                {snapshot.remotes.length ? (
                  <>
                    <div
                      className="hosting-remote-options"
                      role="group"
                      aria-label={t("Remote per associazione")}
                    >
                      {snapshot.remotes.map((item) => (
                        <button
                          key={item.name}
                          disabled={busy}
                          className={remote === item.name ? "active" : ""}
                          title={item.fetch}
                          onClick={() => selectRemote(item.name)}
                        >
                          <GitPullRequest size={14} />
                          {item.name}
                        </button>
                      ))}
                    </div>
                    <div
                      className="hosting-binding-options"
                      role="group"
                      aria-label={t("Profilo per associazione")}
                    >
                      <button
                        disabled={busy}
                        className={!bindingProfile ? "active" : ""}
                        onClick={() => setBindingProfile(null)}
                      >
                        {t("Automatico / GitHub CLI")}
                      </button>
                      {configuration.profiles.map((profile) => (
                        <button
                          key={profile.id}
                          disabled={busy}
                          className={
                            bindingProfile === profile.id ? "active" : ""
                          }
                          onClick={() => setBindingProfile(profile.id)}
                        >
                          {profile.name}
                        </button>
                      ))}
                    </div>
                    <button
                      disabled={busy || loading}
                      onClick={() => void bind()}
                    >
                      <Link2 size={14} />
                      {t("Salva associazione")}
                    </button>
                    <small>
                      {t(
                        "Il test usa il profilo aperto sopra e il remote selezionato. L’associazione determina il profilo usato nella pagina Integrazioni.",
                      )}
                    </small>
                  </>
                ) : (
                  <p>
                    {t(
                      "Nessun remote configurato. Aggiungilo dal menu Operazioni Git prima di collegare un hosting.",
                    )}
                  </p>
                )}
              </section>
            )}
            {error && (
              <div className="hosting-error" role="alert">
                <AlertTriangle size={16} />
                <pre>{t(error)}</pre>
              </div>
            )}
            {notice && (
              <div className="hosting-notice" role="status">
                <Check size={16} />
                <p>{t(notice.key, notice.params)}</p>
              </div>
            )}
          </main>
        </div>
        <footer>
          <span>
            <ShieldCheck size={13} />
            {t(
              "Le integrazioni leggono PR e issue; Git usa la propria autenticazione.",
            )}
          </span>
          <button disabled={busy} onClick={() => requestSelect("close")}>
            {t("Chiudi")}
          </button>
        </footer>
        {removeId && (
          <div className="hosting-confirm-overlay">
            <div role="alertdialog" aria-modal="true">
              <Trash2 size={23} />
              <h3>{t("Eliminare questo profilo?")}</h3>
              <p>
                {t(
                  "Rimuove il profilo, le sue credenziali e le associazioni salvate. Il repository e i remote Git restano invariati.",
                )}
              </p>
              <div>
                <button disabled={busy} onClick={() => setRemoveId(null)}>
                  {t("Annulla")}
                </button>
                <button
                  className="hosting-danger"
                  disabled={busy}
                  onClick={() => void remove()}
                >
                  {t("Elimina profilo")}
                </button>
              </div>
            </div>
          </div>
        )}
        {discardTarget && (
          <div className="hosting-confirm-overlay">
            <div role="alertdialog" aria-modal="true">
              <AlertTriangle size={23} />
              <h3>{t("Modifiche non salvate")}</h3>
              <p>
                {t(
                  "Il profilo contiene modifiche o una nuova credenziale. Salva prima di passare a un altro profilo.",
                )}
              </p>
              <div>
                <button onClick={() => setDiscardTarget(null)}>
                  {t("Torna al profilo")}
                </button>
                <button
                  onClick={() => {
                    const target = discardTarget;
                    setDiscardTarget(null);
                    selectDraft(target);
                  }}
                >
                  {t("Scarta modifiche")}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export function HostingIntegration({
  snapshot,
  revision,
  onOpenSettings,
}: {
  snapshot: Snapshot;
  revision: number;
  onOpenSettings: () => void;
}) {
  const { t, formatNumber } = useI18n();
  const [remote, setRemote] = useState<string | undefined>(),
    [status, setStatus] = useState<HostingStatus | null>(null),
    [prs, setPrs] = useState<HostingItem[]>([]),
    [issues, setIssues] = useState<HostingItem[]>([]),
    [tab, setTab] = useState<"prs" | "issues">("prs"),
    [error, setError] = useState(""),
    [listErrors, setListErrors] = useState<{ prs?: string; issues?: string }>(
      {},
    ),
    [reload, setReload] = useState(0),
    [loadingLists, setLoadingLists] = useState(false);
  useEffect(() => {
    setRemote(undefined);
  }, [snapshot.path]);
  useEffect(() => {
    let active = true;
    setStatus(null);
    setError("");
    setPrs([]);
    setIssues([]);
    setListErrors({});
    setLoadingLists(false);
    const payload = { path: snapshot.path, ...(remote ? { remote } : {}) };
    invoke<HostingStatus>("provider.status", payload)
      .then(async (next) => {
        if (!active) return;
        setStatus(next);
        if (!next.authenticated) return;
        setLoadingLists(true);
        const results = await Promise.allSettled([
          next.capabilities?.prs === false
            ? Promise.resolve<HostingItem[]>([])
            : invoke<HostingItem[]>("provider.prs", payload),
          next.capabilities?.issues === false
            ? Promise.resolve<HostingItem[]>([])
            : invoke<HostingItem[]>("provider.issues", payload),
        ]);
        if (!active) return;
        const errors: { prs?: string; issues?: string } = {};
        if (results[0].status === "fulfilled") setPrs(results[0].value);
        else errors.prs = describeError(results[0].reason);
        if (results[1].status === "fulfilled") setIssues(results[1].value);
        else errors.issues = describeError(results[1].reason);
        setListErrors(errors);
        setLoadingLists(false);
      })
      .catch((e) => {
        if (active) {
          setError(describeError(e));
          setLoadingLists(false);
        }
      });
    return () => {
      active = false;
    };
  }, [snapshot.path, remote, revision, reload]);
  const providerName =
    hostingProviders.find((provider) => provider.id === status?.provider)
      ?.name || t("Hosting Git");
  const selectedError = error || listErrors[tab];
  const items = tab === "prs" ? prs : issues;
  const capable = status?.capabilities?.[tab] !== false;
  return (
    <div className="integrations-view hosting-integration">
      <div className="page-heading">
        <div>
          <div className="eyebrow">{t("DAL REPOSITORY AL TEAM")}</div>
          <h2>{providerName}</h2>
          <p>
            {status?.host
              ? `${status.host} · ${status.repository || ""}`
              : t("Pull request e issue del remote selezionato.")}
          </p>
        </div>
        <button className="secondary" onClick={onOpenSettings}>
          <Server size={16} />
          {t("Profili hosting")}
        </button>
      </div>
      <div className="hosting-integration-remotes">
        <span>{t("REMOTE")}</span>
        {snapshot.remotes.map((item) => (
          <button
            key={item.name}
            className={(remote || status?.remote) === item.name ? "active" : ""}
            title={item.fetch}
            onClick={() => {
              setStatus(null);
              setRemote(item.name);
            }}
          >
            <Link2 size={13} />
            {item.name}
          </button>
        ))}
        <button
          className="icon-button"
          title={t("Ricarica integrazione")}
          onClick={() => setReload((value) => value + 1)}
        >
          <RefreshCw size={15} />
        </button>
      </div>
      {error ? (
        <div className="provider-error" role="alert">
          <AlertTriangle size={16} />
          <div>
            <strong>{t("Connessione non disponibile")}</strong>
            <pre>{t(error)}</pre>
            <button onClick={() => setReload((value) => value + 1)}>
              {t("Riprova")}
            </button>
          </div>
        </div>
      ) : !status ? (
        <div className="loading-state">
          <LoaderCircle className="spin" size={22} />
          {t("Verifica della connessione…")}
        </div>
      ) : !status.authenticated ? (
        <div className="provider-connect">
          <div className="provider-status">
            <Server size={28} />
            <h3>
              {status.provider
                ? t("Configura l’accesso all’hosting")
                : t("Scegli remote e provider")}
            </h3>
            <p>{status.message}</p>
          </div>
          <button className="secondary" onClick={onOpenSettings}>
            <KeyRound size={15} />
            {t("Configura profili e associazioni")}
          </button>
          <p className="fineprint">
            {t(
              "I comandi Git e i remote generici restano disponibili. Questa integrazione usa le API del servizio per leggere PR e issue.",
            )}
          </p>
        </div>
      ) : (
        <>
          <div className="provider-connected">
            <span className="status-dot" />
            {t("{provider} collegato", { provider: providerName })}
            <span>
              {status.remote} ·{" "}
              {status.profileId
                ? t("Profilo configurato")
                : t("Accesso disponibile sul computer")}
            </span>
          </div>
          <div className="integration-tabs">
            <button
              className={tab === "prs" ? "active" : ""}
              onClick={() => setTab("prs")}
            >
              <GitPullRequest size={15} />
              {status.provider === "gitlab"
                ? t("Merge request")
                : t("Pull request")}
              <span>{loadingLists ? "…" : formatNumber(prs.length)}</span>
            </button>
            <button
              className={tab === "issues" ? "active" : ""}
              onClick={() => setTab("issues")}
            >
              <Inbox size={15} />
              {status.provider === "azure-devops" ? t("Work item") : t("Issue")}
              <span>
                {status.capabilities?.issues === false
                  ? "—"
                  : loadingLists
                    ? "…"
                    : formatNumber(issues.length)}
              </span>
            </button>
          </div>
          {!capable ? (
            <div className="hosting-integration-empty">
              <Inbox size={29} />
              <h3>
                {tab === "issues"
                  ? t("Issue non disponibili per questo hosting")
                  : t("Pull request non disponibili")}
              </h3>
              <p>
                {t(
                  "L’adapter non espone questa funzione. Puoi usare le funzionalità supportate dal servizio e i comandi Git.",
                )}
              </p>
            </div>
          ) : selectedError ? (
            <div className="provider-error" role="alert">
              <AlertTriangle size={16} />
              <div>
                <strong>
                  {tab === "prs"
                    ? t("Impossibile caricare le richieste")
                    : t("Impossibile caricare le issue")}
                </strong>
                <pre>{selectedError}</pre>
                <button onClick={() => setReload((value) => value + 1)}>
                  {t("Riprova")}
                </button>
              </div>
            </div>
          ) : loadingLists ? (
            <div className="loading-state">
              <LoaderCircle className="spin" size={22} />
              {t("Caricamento elementi…")}
            </div>
          ) : items.length ? (
            items.map((item) => (
              <button
                className="provider-item"
                key={`${item.id || item.number}-${item.url}`}
                onClick={() =>
                  void invoke("app.external", { url: item.url }).catch((e) =>
                    setError(describeError(e)),
                  )
                }
              >
                {tab === "prs" ? (
                  <GitPullRequest size={18} />
                ) : (
                  <Inbox size={18} />
                )}
                <div>
                  <strong>{item.title}</strong>
                  <span>
                    #{item.number} · {item.author?.login || ""} ·{" "}
                    {item.state?.toLowerCase() || ""}
                  </span>
                </div>
                {item.isDraft && <span className="badge">{t("Bozza")}</span>}
                <ExternalLink size={14} />
              </button>
            ))
          ) : (
            <div className="hosting-integration-empty">
              <Check size={29} />
              <h3>
                {tab === "prs"
                  ? t("Nessuna richiesta aperta")
                  : t("Nessuna issue aperta")}
              </h3>
              <p>
                {t(
                  "La lettura del repository selezionato non ha restituito elementi aperti.",
                )}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
