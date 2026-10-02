import { useEffect, useRef, useState } from "react";
import {
  X,
  GitCompare,
  History,
  GitPullRequest,
  ChevronUp,
  ChevronDown,
  FileCode,
  Sparkles,
  Copy,
  Download,
  Check,
  Play,
  Scissors,
  Settings2,
  Server,
  Cloud,
  RefreshCw,
  LoaderCircle,
} from "lucide-react";
import type { Snapshot, Commit } from "./types";
import { useI18n } from "./i18n";
import "./tools.css";
import "./ai-settings.css";
import {
  AIProviders,
  aiDestination,
  isLocalAIProfile,
  type AIProfile,
  type AIConfiguration,
} from "./AISettings";
type PlanRow = {
  hash: string;
  subject: string;
  action: string;
  message: string;
};
export default function ToolsPanel({
  snapshot,
  onClose,
  onChanged,
  onOpenAISettings,
  aiSettingsVersion = 0,
}: {
  snapshot: Snapshot;
  onClose: () => void;
  onChanged: () => void;
  onOpenAISettings?: () => void;
  aiSettingsVersion?: number;
}) {
  const { t, formatNumber } = useI18n();
  const defaultPrompt = t(
    "Scrivi un messaggio di commit conciso in inglese per queste modifiche. Spiega poi i rischi principali.",
  );
  const previousDefaultPrompt = useRef(defaultPrompt);
  const [tab, setTab] = useState("compare"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState("");
  const [from, setFrom] = useState(
      snapshot.branches.find((b) => !b.current && !b.remote)?.name || "HEAD~1",
    ),
    [to, setTo] = useState("HEAD"),
    [file, setFile] = useState(""),
    [history, setHistory] = useState<Commit[]>([]);
  const [base, setBase] = useState(
      snapshot.branches.find((b) => !b.current && !b.remote)?.name || "HEAD~3",
    ),
    [plan, setPlan] = useState<PlanRow[]>([]),
    [patch, setPatch] = useState("");
  const [models, setModels] = useState<string[]>([]),
    [model, setModel] = useState(""),
    [prompt, setPrompt] = useState(defaultPrompt),
    [aiState, setAiState] = useState(""),
    [profiles, setProfiles] = useState<AIProfile[]>([]),
    [profileId, setProfileId] = useState(""),
    [aiLoading, setAILoading] = useState(false),
    [profileReload, setProfileReload] = useState(0);
  const selectedProfile = profiles.find((p) => p.id === profileId);
  useEffect(() => {
    setPrompt((current) =>
      current === previousDefaultPrompt.current ? defaultPrompt : current,
    );
    previousDefaultPrompt.current = defaultPrompt;
  }, [defaultPrompt]);
  useEffect(() => {
    if (tab !== "ai") return;
    let active = true;
    setAILoading(true);
    window.branchline
      .invoke<AIConfiguration>("ai.settings")
      .then((config) => {
        if (!active) return;
        setProfiles(config.profiles);
        const p =
          config.profiles.find((p) => p.id === config.activeProfileId) ||
          config.profiles[0];
        setProfileId(p?.id || "");
        setModel(p?.model || "");
        setModels([]);
        setAiState("");
      })
      .catch((e) => active && setError(e.message))
      .finally(() => active && setAILoading(false));
    return () => {
      active = false;
    };
  }, [tab, aiSettingsVersion, profileReload]);
  async function task(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const invoke = <T,>(method: string, payload: Record<string, unknown> = {}) =>
    window.branchline.invoke<T>(method, { path: snapshot.path, ...payload });
  const tabs = [
    ["compare", "Confronta", GitCompare],
    ["history", "Storia file", History],
    ["rebase", "Rebase interattivo", GitPullRequest],
    ["patch", "Patch", Scissors],
    ["ai", "Assistente AI", Sparkles],
  ] as const;
  function move(index: number, delta: number) {
    const next = [...plan];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    setPlan(next);
  }
  function exportText(text: string, name: string) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="tools-backdrop">
      <section
        className="tools-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("Strumenti repository")}
      >
        <header>
          <div>
            <span className="tools-eyebrow">{t("BRANCHLINE / STRUMENTI")}</span>
            <h2>{t("Un controllo più preciso.")}</h2>
            <p>
              {snapshot.name} <span>· {snapshot.branch}</span>
            </p>
          </div>
          <button onClick={onClose} aria-label={t("Chiudi strumenti")}>
            <X size={20} />
          </button>
        </header>
        <nav>
          {tabs.map(([id, label, Icon]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => {
                setTab(id);
                setResult("");
                setError("");
              }}
            >
              <Icon size={15} />
              {t(label)}
            </button>
          ))}
        </nav>
        <div className="tools-body">
          {tab === "compare" && (
            <>
              <p className="tools-hint">
                {t(
                  "Confronta due branch, tag o commit. Il risultato mostra le modifiche da A a B.",
                )}
              </p>
              <div className="tools-row">
                <label>
                  {t("Da")}
                  <input
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    list="tools-refs"
                  />
                </label>
                <GitCompare size={18} />
                <label>
                  {t("A")}
                  <input
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    list="tools-refs"
                  />
                </label>
                <button
                  className="tools-primary"
                  disabled={busy}
                  onClick={() =>
                    task(async () =>
                      setResult(
                        await invoke<string>("repo.diff", { from, to }),
                      ),
                    )
                  }
                >
                  {t("Confronta")}
                </button>
              </div>
              <datalist id="tools-refs">
                {snapshot.branches.map((b) => (
                  <option key={b.name}>{b.name}</option>
                ))}
                {snapshot.tags.map((t) => (
                  <option key={t.name}>{t.name}</option>
                ))}
              </datalist>
            </>
          )}
          {tab === "history" && (
            <>
              <p className="tools-hint">
                {t(
                  "Cerca le modifiche di un file e chi ha scritto ciascuna riga. Percorso relativo al repository.",
                )}
              </p>
              <div className="tools-row">
                <label className="grow">
                  {t("File")}
                  <input
                    value={file}
                    placeholder="src/App.tsx"
                    onChange={(e) => setFile(e.target.value)}
                  />
                </label>
                <button
                  disabled={!file || busy}
                  onClick={() =>
                    task(async () => {
                      setHistory(
                        await invoke<Commit[]>("repo.history", { file }),
                      );
                      setResult("");
                    })
                  }
                >
                  {t("Cronologia")}
                </button>
                <button
                  disabled={!file || busy}
                  onClick={() =>
                    task(async () => {
                      setResult(await invoke<string>("repo.blame", { file }));
                      setHistory([]);
                    })
                  }
                >
                  Blame
                </button>
                <button
                  disabled={!file || busy}
                  onClick={() =>
                    task(async () => {
                      setResult(await invoke<string>("repo.file", { file }));
                      setHistory([]);
                    })
                  }
                >
                  {t("Leggi")}
                </button>
              </div>
              {history.length > 0 && (
                <div className="tools-history">
                  {history.map((c) => (
                    <button
                      key={c.hash}
                      onClick={() =>
                        task(async () =>
                          setResult(
                            await invoke<string>("repo.diff", {
                              commit: c.hash,
                              file,
                            }),
                          ),
                        )
                      }
                    >
                      <code>{c.shortHash}</code>
                      <strong>{c.subject}</strong>
                      <span>{c.author}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {tab === "rebase" && (
            <>
              <p className="tools-hint">
                {t(
                  "Riscrivi solo commit locali: riordina, unisci o cambia il messaggio. Viene creata una ref di recupero; il working tree deve essere pulito.",
                )}
              </p>
              <div className="tools-row">
                <label className="grow">
                  {t("Base del rebase")}
                  <input
                    value={base}
                    onChange={(e) => {
                      setBase(e.target.value);
                      setPlan([]);
                    }}
                    list="tools-refs"
                  />
                </label>
                <button
                  disabled={busy}
                  onClick={() =>
                    task(async () => {
                      const commits = await invoke<Commit[]>(
                        "repo.rebasePlan",
                        { base },
                      );
                      setPlan(
                        commits.map((c) => ({
                          hash: c.hash,
                          subject: c.subject,
                          action: "pick",
                          message: c.subject,
                        })),
                      );
                      setResult("");
                    })
                  }
                >
                  {t("Carica commit")}
                </button>
              </div>
              {plan.length > 0 && (
                <>
                  <div className="tools-plan">
                    {plan.map((row, index) => (
                      <div key={row.hash}>
                        <div className="tools-order">
                          <button
                            disabled={index === 0}
                            onClick={() => move(index, -1)}
                            title={t("Sposta prima")}
                          >
                            <ChevronUp size={13} />
                          </button>
                          <button
                            disabled={index === plan.length - 1}
                            onClick={() => move(index, 1)}
                            title={t("Sposta dopo")}
                          >
                            <ChevronDown size={13} />
                          </button>
                        </div>
                        <code>{row.hash.slice(0, 7)}</code>
                        <div
                          className="tools-actions"
                          role="group"
                          aria-label={t("Azione per {hash}", {
                            hash: row.hash.slice(0, 7),
                          })}
                        >
                          {["pick", "reword", "squash", "fixup", "drop"].map(
                            (a) => (
                              <button
                                key={a}
                                aria-pressed={row.action === a}
                                className={row.action === a ? "selected" : ""}
                                onClick={() =>
                                  setPlan(
                                    plan.map((r, i) =>
                                      i === index ? { ...r, action: a } : r,
                                    ),
                                  )
                                }
                              >
                                {a}
                              </button>
                            ),
                          )}
                        </div>
                        {row.action === "reword" ? (
                          <input
                            aria-label={t("Nuovo messaggio")}
                            value={row.message}
                            onChange={(e) =>
                              setPlan(
                                plan.map((r, i) =>
                                  i === index
                                    ? { ...r, message: e.target.value }
                                    : r,
                                ),
                              )
                            }
                          />
                        ) : (
                          <span>{row.subject}</span>
                        )}
                      </div>
                    ))}
                  </div>
                  <button
                    className="tools-primary"
                    disabled={busy || snapshot.files.length > 0}
                    onClick={() =>
                      task(async () => {
                        try {
                          const r = await invoke<{ output: string }>(
                            "repo.action",
                            { operation: "interactive.rebase", base, plan },
                          );
                          setResult(r.output || t("Rebase completato."));
                          setPlan([]);
                        } finally {
                          onChanged();
                        }
                      })
                    }
                  >
                    <Play size={14} />
                    {t("Esegui questo piano")}
                  </button>
                  {snapshot.files.length > 0 && (
                    <p className="tools-hint">
                      {t(
                        "Fai commit o stash delle modifiche prima del rebase.",
                      )}
                    </p>
                  )}
                </>
              )}
            </>
          )}
          {tab === "patch" && (
            <>
              <p className="tools-hint">
                {t(
                  "Condividi le modifiche come file locale .patch. Puoi importarlo senza un servizio cloud; Git controlla che sia applicabile.",
                )}
              </p>
              <div className="tools-row">
                <button
                  disabled={busy}
                  onClick={() =>
                    task(async () => {
                      const diff = await invoke<string>("repo.diff", {});
                      setPatch(diff);
                      setResult("");
                    })
                  }
                >
                  <FileCode size={14} />
                  {t("Modifiche non staged")}
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    task(async () => {
                      setPatch(
                        await invoke<string>("repo.diff", { staged: true }),
                      );
                      setResult("");
                    })
                  }
                >
                  {t("Modifiche staged")}
                </button>
                <label className="tools-upload">
                  {t("Importa .patch")}
                  <input
                    type="file"
                    accept=".patch,.diff,text/plain"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        setPatch(await f.text());
                        setResult("");
                      }
                    }}
                  />
                </label>
                <button
                  disabled={!patch}
                  onClick={() => exportText(patch, "branchline.patch")}
                >
                  <Download size={14} />
                  {t("Esporta")}
                </button>
              </div>
              <textarea
                className="tools-patch"
                spellCheck={false}
                value={patch}
                placeholder={t("Incolla una patch Git o importa un file…")}
                onChange={(e) => setPatch(e.target.value)}
              />
              <button
                disabled={busy || !patch}
                className="tools-primary"
                onClick={() =>
                  task(async () => {
                    const r = await invoke<{ output: string }>("repo.action", {
                      operation: "patch.apply",
                      patch,
                    });
                    setResult(r.output || t("Patch applicata."));
                    onChanged();
                  })
                }
              >
                <Check size={14} />
                {t("Controlla e applica")}
              </button>
            </>
          )}
          {tab === "ai" && (
            <>
              <div className="tools-ai-heading">
                <h3>{t("Assistente per il tuo repository")}</h3>
                <button
                  disabled={busy || aiLoading}
                  onClick={() => setProfileReload((v) => v + 1)}
                >
                  <RefreshCw size={13} />
                  {t("Ricarica profili")}
                </button>
                {onOpenAISettings && (
                  <button onClick={onOpenAISettings} disabled={busy}>
                    <Settings2 size={14} />
                    {t("Profili e modelli AI")}
                  </button>
                )}
              </div>
              <p className="tools-hint">
                {t(
                  "Scegli un profilo e un modello. I suggerimenti vengono mostrati per revisione e non eseguono comandi Git.",
                )}
              </p>
              {aiLoading ? (
                <div className="tools-ai-load">
                  <LoaderCircle size={18} className="spin" />
                  {t("Caricamento profili salvati…")}
                </div>
              ) : profiles.length ? (
                <>
                  <div
                    className="tools-ai-profiles"
                    role="group"
                    aria-label={t("Profilo AI per il suggerimento")}
                  >
                    {profiles.map((profile) => (
                      <button
                        key={profile.id}
                        className={profileId === profile.id ? "selected" : ""}
                        aria-pressed={profileId === profile.id}
                        disabled={busy}
                        onClick={() => {
                          setProfileId(profile.id);
                          setModel(profile.model || "");
                          setModels([]);
                          setAiState("");
                          setResult("");
                        }}
                      >
                        {isLocalAIProfile(profile) ? (
                          <Server size={15} />
                        ) : (
                          <Cloud size={15} />
                        )}
                        <span>
                          {profile.name}
                          <small>
                            {t(
                              AIProviders.find((p) => p.id === profile.provider)
                                ?.name || profile.provider,
                            )}
                          </small>
                        </span>
                        {profileId === profile.id && <Check size={12} />}
                      </button>
                    ))}
                  </div>
                  <div className="tools-row">
                    <label className="grow">
                      {t("Modello")}
                      <input
                        aria-label={t("Modello AI del suggerimento")}
                        list="tools-ai-models"
                        placeholder={t("Modello salvato o ID manuale")}
                        value={model}
                        disabled={busy}
                        onChange={(e) => setModel(e.target.value)}
                      />
                    </label>
                    <button
                      disabled={busy || !selectedProfile}
                      onClick={() =>
                        task(async () => {
                          const status = await invoke<{
                            models: string[];
                            message: string;
                          }>("ai.models", { profileId });
                          setModels(status.models);
                          setAiState(
                            status.message ||
                              t("{count} modelli disponibili.", {
                                count: formatNumber(status.models.length),
                              }),
                          );
                        })
                      }
                    >
                      <RefreshCw size={13} />
                      {t("Rileva modelli")}
                    </button>
                    <button
                      disabled={busy || !selectedProfile || !model.trim()}
                      onClick={() =>
                        task(async () => {
                          await invoke("ai.activate", {
                            id: profileId,
                            model: model.trim(),
                          });
                          const config =
                            await invoke<AIConfiguration>("ai.settings");
                          setProfiles(config.profiles);
                          setAiState(
                            t("Profilo e modello salvati come scelta attiva."),
                          );
                        })
                      }
                    >
                      <Check size={13} />
                      {t("Usa come attivo")}
                    </button>
                  </div>
                  <datalist id="tools-ai-models">
                    {models.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                  {selectedProfile && (
                    <div
                      className={`tools-ai-destination ${isLocalAIProfile(selectedProfile) ? "local" : ""}`}
                    >
                      {isLocalAIProfile(selectedProfile) ? (
                        <Server size={17} />
                      ) : (
                        <Cloud size={17} />
                      )}
                      <div>
                        <strong>{aiDestination(selectedProfile, t)}</strong>
                        <p>
                          {snapshot.files.some((f) => f.staged)
                            ? t(
                                "Il diff dei file nello staging verrà inviato al profilo “{name}” usando {model}.",
                                {
                                  name: selectedProfile.name,
                                  model: model || t("il modello scelto"),
                                },
                              )
                            : t(
                                "Il diff delle modifiche non preparate verrà inviato al profilo “{name}” usando {model}.",
                                {
                                  name: selectedProfile.name,
                                  model: model || t("il modello scelto"),
                                },
                              )}
                          {selectedProfile.provider === "litellm"
                            ? " " +
                              t(
                                "Il gateway può inoltrare i dati a servizi cloud.",
                              )
                            : ""}
                        </p>
                      </div>
                    </div>
                  )}
                  {aiState && <p className="tools-hint">{aiState}</p>}
                  <label>
                    {t("Richiesta")}
                    <textarea
                      value={prompt}
                      disabled={busy}
                      onChange={(e) => setPrompt(e.target.value)}
                    />
                  </label>
                  <button
                    className="tools-primary"
                    disabled={
                      busy ||
                      !selectedProfile ||
                      !model.trim() ||
                      !prompt.trim()
                    }
                    onClick={() =>
                      task(async () => {
                        const diff = await invoke<string>("repo.diff", {
                          staged: snapshot.files.some((f) => f.staged),
                        });
                        setResult(
                          await invoke<string>("ai.generate", {
                            profileId,
                            model: model.trim(),
                            prompt,
                            diff,
                          }),
                        );
                      })
                    }
                  >
                    <Sparkles size={14} />
                    {t("Genera suggerimento")}
                  </button>
                </>
              ) : (
                <div className="tools-ai-load">
                  <Settings2 size={18} />
                  <span>{t("Nessun profilo AI configurato.")}</span>
                  {onOpenAISettings && (
                    <button onClick={onOpenAISettings}>
                      {t("Configura un provider")}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
          {error && (
            <div className="tools-error" role="alert">
              {error}
            </div>
          )}
          {busy && <p className="tools-hint">{t("Operazione in corso…")}</p>}
          {result && (
            <div className="tools-output">
              <header>
                <span>{t("Risultato")}</span>
                <button onClick={() => navigator.clipboard.writeText(result)}>
                  <Copy size={13} />
                  {t("Copia")}
                </button>
              </header>
              <pre>{result}</pre>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
