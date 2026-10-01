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
  const [configuration, setConfiguration] =
      useState<HostingConfiguration>(emptyConfiguration),
    [draft, setDraft] = useState<HostingProfile | null>(null),
    [credential, setCredential] = useState(""),
    [remote, setRemote] = useState(snapshot?.remotes[0]?.name || ""),
    [bindingProfile, setBindingProfile] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
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
    setNotice("");
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
    setNotice("");
    setTest(null);
  };
  const save = async () => {
    if (!draft || !draft.name.trim() || !draft.baseUrl.trim()) return;
    setBusy(true);
    setError("");
    setNotice("");
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
      setNotice(
        "Profilo salvato. Le credenziali restano cifrate sul computer.",
      );
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
      setNotice(
        "Profilo e credenziali eliminati. I remote Git non sono stati modificati.",
      );
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
    setNotice("");
    try {
      const data = await invoke<HostingConfiguration>("provider.bind", {
        path: snapshot.path,
        remote,
        profileId: bindingProfile,
      });
      if (!active.current) return;
      setConfiguration(data);
      setNotice(
        `Associazione salvata per ${snapshot.name} · ${remote}. Il remote Git rimane invariato.`,
      );
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
    setNotice("");
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
            <div className="eyebrow">REPOSITORY E ACCOUNT</div>
            <h2 id="hosting-settings-title">Profili hosting</h2>
            <p>Servizi pubblici, server aziendali e credenziali protette.</p>
          </div>
          <button
            className="icon-button"
            aria-label="Chiudi profili hosting"
            onClick={() => requestSelect("close")}
            disabled={busy}
          >
            <X size={19} />
          </button>
        </header>
        <div className="hosting-workspace">
          <aside className="hosting-profile-list">
            <div className="hosting-list-heading">
              <span>PROFILI</span>
              <button
                onClick={() => requestSelect("new")}
                disabled={busy || loading}
                aria-label="Aggiungi profilo hosting"
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
                Aggiungi un profilo per il tuo account o server. GitHub può
                usare anche GitHub CLI.
              </p>
            )}
            <div className="hosting-privacy-note">
              <ShieldCheck size={16} />
              <p>
                I profili contengono metadati. Le chiavi sono cifrate
                separatamente e non vengono restituite all’interfaccia.
              </p>
            </div>
          </aside>
          <main className="hosting-editor">
            {loading ? (
              <div className="loading-state">
                <LoaderCircle className="spin" size={22} />
                Caricamento profili…
              </div>
            ) : draft ? (
              <>
                <div className="hosting-editor-heading">
                  <div>
                    <h3>{draft.name || "Nuovo profilo"}</h3>
                    <p>{dirty ? "Modifiche da salvare" : "Profilo salvato"}</p>
                  </div>
                  {savedProfile && (
                    <button
                      className="hosting-delete"
                      disabled={busy}
                      onClick={() => setRemoveId(draft.id)}
                    >
                      <Trash2 size={14} />
                      Elimina
                    </button>
                  )}
                </div>
                <label className="hosting-field">
                  <span>Nome del profilo</span>
                  <input
                    value={draft.name}
                    disabled={busy}
                    placeholder="Account personale o server aziendale"
                    onChange={(event) => update({ name: event.target.value })}
                  />
                </label>
                <div className="hosting-field">
                  <span>Provider</span>
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
                  <span>URL server / organizzazione</span>
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
                    HTTPS, incluso l’eventuale prefisso del server. Gli endpoint
                    API dipendono dal provider. Per Azure indica
                    l’organizzazione o la collection.
                  </small>
                </label>
                {draft.provider === "azure-devops" && (
                  <label className="hosting-field">
                    <span>Versione API Azure</span>
                    <input
                      value={draft.apiVersion || ""}
                      disabled={busy}
                      placeholder="Facoltativa · predefinita 7.1"
                      onChange={(event) =>
                        update({ apiVersion: event.target.value })
                      }
                    />
                    <small>
                      Per Azure DevOps Server usa una versione supportata dalla
                      tua installazione.
                    </small>
                  </label>
                )}
                <div className="hosting-field">
                  <span>Autenticazione</span>
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
                        {authNames[mode]}
                      </button>
                    ))}
                  </div>
                </div>
                {draft.authMode === "none" ? (
                  <div className="hosting-inline-note">
                    <Cloud size={16} />
                    <p>
                      Legge i repository pubblici senza inviare una credenziale.
                      Il servizio può applicare limiti più stretti; i repository
                      privati richiedono un’altra modalità.
                    </p>
                  </div>
                ) : draft.authMode === "gh" ? (
                  <div className="hosting-inline-note">
                    <Link2 size={16} />
                    <p>
                      Usa l’accesso di GitHub CLI per il server selezionato.
                      Configuralo dal terminale con{" "}
                      <code>gh auth login --hostname HOST</code>. Branchline non
                      legge né mostra i token salvati da gh.
                    </p>
                  </div>
                ) : (
                  <>
                    {draft.authMode === "basic" && (
                      <label className="hosting-field">
                        <span>
                          {draft.provider === "bitbucket-cloud"
                            ? "Email dell’account"
                            : "Utente / account"}
                        </span>
                        <input
                          value={draft.username || ""}
                          disabled={busy}
                          autoComplete="off"
                          placeholder={
                            draft.provider === "azure-devops"
                              ? "Facoltativo per PAT Azure"
                              : draft.provider === "bitbucket-cloud"
                                ? "Email associata all’API token"
                                : "Nome account richiesto dal server"
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
                            ? "API token / OAuth / access token"
                            : "Bearer token"
                          : draft.provider === "azure-devops"
                            ? "Personal access token (PAT)"
                            : "Token / API key"}
                        {draft.hasCredential && (
                          <em>Credenziale già salvata</em>
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
                            ? "Lascia vuoto per conservare la credenziale"
                            : "Inserisci la credenziale del provider"
                        }
                        onChange={(event) => {
                          setCredential(event.target.value);
                          setTest(null);
                          setNotice("");
                        }}
                      />
                      <small>
                        Valore usato solo al salvataggio. I segreti salvati non
                        vengono mostrati, nemmeno parzialmente.
                        {draft.provider === "bitbucket-cloud"
                          ? " Usa API token, non app password."
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
                    Salva profilo
                  </button>
                  <button
                    disabled={busy || dirty || !snapshot || !remote}
                    title={
                      dirty
                        ? "Salva il profilo prima del test"
                        : "Richiesta in sola lettura al repository del remote selezionato"
                    }
                    onClick={() => void testConnection()}
                  >
                    <RefreshCw size={14} />
                    Test connessione
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
                          ? "Repository raggiungibile"
                          : "Accesso da verificare"}
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
                <h3>Connetti il tuo hosting Git</h3>
                <p>
                  Aggiungi un account pubblico o il tuo server aziendale. I
                  comandi Git locali e i remote funzionano anche senza questi
                  profili.
                </p>
                <button
                  className="hosting-primary"
                  onClick={() => requestSelect("new")}
                >
                  <Plus size={15} />
                  Aggiungi profilo
                </button>
              </div>
            )}
            {snapshot && (
              <section className="hosting-binding">
                <div>
                  <h3>Associa al repository</h3>
                  <p>
                    {snapshot.name} · seleziona il remote e il profilo. Non
                    modifica gli URL Git.
                  </p>
                </div>
                {snapshot.remotes.length ? (
                  <>
                    <div
                      className="hosting-remote-options"
                      role="group"
                      aria-label="Remote per associazione"
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
                      aria-label="Profilo per associazione"
                    >
                      <button
                        disabled={busy}
                        className={!bindingProfile ? "active" : ""}
                        onClick={() => setBindingProfile(null)}
                      >
                        Automatico / GitHub CLI
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
                      Salva associazione
                    </button>
                    <small>
                      Il test usa il profilo aperto sopra e il remote
                      selezionato. L’associazione determina il profilo usato
                      nella pagina Integrazioni.
                    </small>
                  </>
                ) : (
                  <p>
                    Nessun remote configurato. Aggiungilo dal menu Operazioni
                    Git prima di collegare un hosting.
                  </p>
                )}
              </section>
            )}
            {error && (
              <div className="hosting-error" role="alert">
                <AlertTriangle size={16} />
                <pre>{error}</pre>
              </div>
            )}
            {notice && (
              <div className="hosting-notice" role="status">
                <Check size={16} />
                <p>{notice}</p>
              </div>
            )}
          </main>
        </div>
        <footer>
          <span>
            <ShieldCheck size={13} />
            Le integrazioni leggono PR e issue; Git usa la propria
            autenticazione.
          </span>
          <button disabled={busy} onClick={() => requestSelect("close")}>
            Chiudi
          </button>
        </footer>
        {removeId && (
          <div className="hosting-confirm-overlay">
            <div role="alertdialog" aria-modal="true">
              <Trash2 size={23} />
              <h3>Eliminare questo profilo?</h3>
              <p>
                Rimuove il profilo, le sue credenziali e le associazioni
                salvate. Il repository e i remote Git restano invariati.
              </p>
              <div>
                <button disabled={busy} onClick={() => setRemoveId(null)}>
                  Annulla
                </button>
                <button
                  className="hosting-danger"
                  disabled={busy}
                  onClick={() => void remove()}
                >
                  Elimina profilo
                </button>
              </div>
            </div>
          </div>
        )}
        {discardTarget && (
          <div className="hosting-confirm-overlay">
            <div role="alertdialog" aria-modal="true">
              <AlertTriangle size={23} />
              <h3>Modifiche non salvate</h3>
              <p>
                Il profilo contiene modifiche o una nuova credenziale. Salva
                prima di passare a un altro profilo.
              </p>
              <div>
                <button onClick={() => setDiscardTarget(null)}>
                  Torna al profilo
                </button>
                <button
                  onClick={() => {
                    const target = discardTarget;
                    setDiscardTarget(null);
                    selectDraft(target);
                  }}
                >
                  Scarta modifiche
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
      ?.name || "Hosting Git";
  const selectedError = error || listErrors[tab];
  const items = tab === "prs" ? prs : issues;
  const capable = status?.capabilities?.[tab] !== false;
  return (
    <div className="integrations-view hosting-integration">
      <div className="page-heading">
        <div>
          <div className="eyebrow">DAL REPOSITORY AL TEAM</div>
          <h2>{providerName}</h2>
          <p>
            {status?.host
              ? `${status.host} · ${status.repository || ""}`
              : "Pull request e issue del remote selezionato."}
          </p>
        </div>
        <button className="secondary" onClick={onOpenSettings}>
          <Server size={16} />
          Profili hosting
        </button>
      </div>
      <div className="hosting-integration-remotes">
        <span>REMOTE</span>
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
          title="Ricarica integrazione"
          onClick={() => setReload((value) => value + 1)}
        >
          <RefreshCw size={15} />
        </button>
      </div>
      {error ? (
        <div className="provider-error" role="alert">
          <AlertTriangle size={16} />
          <div>
            <strong>Connessione non disponibile</strong>
            <pre>{error}</pre>
            <button onClick={() => setReload((value) => value + 1)}>
              Riprova
            </button>
          </div>
        </div>
      ) : !status ? (
        <div className="loading-state">
          <LoaderCircle className="spin" size={22} />
          Verifica della connessione…
        </div>
      ) : !status.authenticated ? (
        <div className="provider-connect">
          <div className="provider-status">
            <Server size={28} />
            <h3>
              {status.provider
                ? "Configura l’accesso all’hosting"
                : "Scegli remote e provider"}
            </h3>
            <p>{status.message}</p>
          </div>
          <button className="secondary" onClick={onOpenSettings}>
            <KeyRound size={15} />
            Configura profili e associazioni
          </button>
          <p className="fineprint">
            I comandi Git e i remote generici restano disponibili. Questa
            integrazione usa le API del servizio per leggere PR e issue.
          </p>
        </div>
      ) : (
        <>
          <div className="provider-connected">
            <span className="status-dot" />
            {providerName} collegato
            <span>
              {status.remote} ·{" "}
              {status.profileId
                ? "Profilo configurato"
                : "Accesso disponibile sul computer"}
            </span>
          </div>
          <div className="integration-tabs">
            <button
              className={tab === "prs" ? "active" : ""}
              onClick={() => setTab("prs")}
            >
              <GitPullRequest size={15} />
              {status.provider === "gitlab" ? "Merge request" : "Pull request"}
              <span>{loadingLists ? "…" : prs.length}</span>
            </button>
            <button
              className={tab === "issues" ? "active" : ""}
              onClick={() => setTab("issues")}
            >
              <Inbox size={15} />
              {status.provider === "azure-devops" ? "Work item" : "Issue"}
              <span>
                {status.capabilities?.issues === false
                  ? "—"
                  : loadingLists
                    ? "…"
                    : issues.length}
              </span>
            </button>
          </div>
          {!capable ? (
            <div className="hosting-integration-empty">
              <Inbox size={29} />
              <h3>
                {tab === "issues"
                  ? "Issue non disponibili per questo hosting"
                  : "Pull request non disponibili"}
              </h3>
              <p>
                L’adapter non espone questa funzione. Puoi usare le funzionalità
                supportate dal servizio e i comandi Git.
              </p>
            </div>
          ) : selectedError ? (
            <div className="provider-error" role="alert">
              <AlertTriangle size={16} />
              <div>
                <strong>
                  Impossibile caricare{" "}
                  {tab === "prs" ? "le richieste" : "le issue"}
                </strong>
                <pre>{selectedError}</pre>
                <button onClick={() => setReload((value) => value + 1)}>
                  Riprova
                </button>
              </div>
            </div>
          ) : loadingLists ? (
            <div className="loading-state">
              <LoaderCircle className="spin" size={22} />
              Caricamento elementi…
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
                {item.isDraft && <span className="badge">Bozza</span>}
                <ExternalLink size={14} />
              </button>
            ))
          ) : (
            <div className="hosting-integration-empty">
              <Check size={29} />
              <h3>
                {tab === "prs"
                  ? "Nessuna richiesta aperta"
                  : "Nessuna issue aperta"}
              </h3>
              <p>
                La lettura del repository selezionato non ha restituito elementi
                aperti.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
