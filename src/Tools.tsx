import { useEffect, useState } from "react";
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
    [prompt, setPrompt] = useState(
      "Scrivi un messaggio di commit conciso in inglese per queste modifiche. Spiega poi i rischi principali.",
    ),
    [aiState, setAiState] = useState(""),
    [profiles, setProfiles] = useState<AIProfile[]>([]),
    [profileId, setProfileId] = useState(""),
    [aiLoading, setAILoading] = useState(false),
    [profileReload, setProfileReload] = useState(0);
  const selectedProfile = profiles.find((p) => p.id === profileId);
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
        aria-label="Strumenti repository"
      >
        <header>
          <div>
            <span className="tools-eyebrow">BRANCHLINE / STRUMENTI</span>
            <h2>Un controllo più preciso.</h2>
            <p>
              {snapshot.name} <span>· {snapshot.branch}</span>
            </p>
          </div>
          <button onClick={onClose} aria-label="Chiudi strumenti">
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
              {label}
            </button>
          ))}
        </nav>
        <div className="tools-body">
          {tab === "compare" && (
            <>
              <p className="tools-hint">
                Confronta due branch, tag o commit. Il risultato mostra le
                modifiche da A a B.
              </p>
              <div className="tools-row">
                <label>
                  Da
                  <input
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    list="tools-refs"
                  />
                </label>
                <GitCompare size={18} />
                <label>
                  A
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
                  Confronta
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
                Cerca le modifiche di un file e chi ha scritto ciascuna riga.
                Percorso relativo al repository.
              </p>
              <div className="tools-row">
                <label className="grow">
                  File
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
                  Cronologia
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
                  Leggi
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
                Riscrivi solo commit locali: riordina, unisci o cambia il
                messaggio. Viene creata una ref di recupero; il working tree
                deve essere pulito.
              </p>
              <div className="tools-row">
                <label className="grow">
                  Base del rebase
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
                  Carica commit
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
                            title="Sposta prima"
                          >
                            <ChevronUp size={13} />
                          </button>
                          <button
                            disabled={index === plan.length - 1}
                            onClick={() => move(index, 1)}
                            title="Sposta dopo"
                          >
                            <ChevronDown size={13} />
                          </button>
                        </div>
                        <code>{row.hash.slice(0, 7)}</code>
                        <div
                          className="tools-actions"
                          role="group"
                          aria-label={`Azione per ${row.hash.slice(0, 7)}`}
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
                            aria-label="Nuovo messaggio"
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
                          setResult(r.output || "Rebase completato.");
                          setPlan([]);
                        } finally {
                          onChanged();
                        }
                      })
                    }
                  >
                    <Play size={14} />
                    Esegui questo piano
                  </button>
                  {snapshot.files.length > 0 && (
                    <p className="tools-hint">
                      Fai commit o stash delle modifiche prima del rebase.
                    </p>
                  )}
                </>
              )}
            </>
          )}
          {tab === "patch" && (
            <>
              <p className="tools-hint">
                Condividi le modifiche come file locale .patch. Puoi importarlo
                senza un servizio cloud; Git controlla che sia applicabile.
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
                  Modifiche non staged
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
                  Modifiche staged
                </button>
                <label className="tools-upload">
                  Importa .patch
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
                  Esporta
                </button>
              </div>
              <textarea
                className="tools-patch"
                spellCheck={false}
                value={patch}
                placeholder="Incolla una patch Git o importa un file…"
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
                    setResult(r.output || "Patch applicata.");
                    onChanged();
                  })
                }
              >
                <Check size={14} />
                Controlla e applica
              </button>
            </>
          )}
          {tab === "ai" && (
            <>
              <div className="tools-ai-heading">
                <h3>Assistente per il tuo repository</h3>
                <button
                  disabled={busy || aiLoading}
                  onClick={() => setProfileReload((v) => v + 1)}
                >
                  <RefreshCw size={13} />
                  Ricarica profili
                </button>
                {onOpenAISettings && (
                  <button onClick={onOpenAISettings} disabled={busy}>
                    <Settings2 size={14} />
                    Profili e modelli AI
                  </button>
                )}
              </div>
              <p className="tools-hint">
                Scegli un profilo e un modello. I suggerimenti vengono mostrati
                per revisione e non eseguono comandi Git.
              </p>
              {aiLoading ? (
                <div className="tools-ai-load">
                  <LoaderCircle size={18} className="spin" />
                  Caricamento profili salvati…
                </div>
              ) : profiles.length ? (
                <>
                  <div
                    className="tools-ai-profiles"
                    role="group"
                    aria-label="Profilo AI per il suggerimento"
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
                            {
                              AIProviders.find((p) => p.id === profile.provider)
                                ?.name
                            }
                          </small>
                        </span>
                        {profileId === profile.id && <Check size={12} />}
                      </button>
                    ))}
                  </div>
                  <div className="tools-row">
                    <label className="grow">
                      Modello
                      <input
                        aria-label="Modello AI del suggerimento"
                        list="tools-ai-models"
                        placeholder="Modello salvato o ID manuale"
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
                              `${status.models.length} modelli disponibili.`,
                          );
                        })
                      }
                    >
                      <RefreshCw size={13} />
                      Rileva modelli
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
                            "Profilo e modello salvati come scelta attiva.",
                          );
                        })
                      }
                    >
                      <Check size={13} />
                      Usa come attivo
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
                        <strong>{aiDestination(selectedProfile)}</strong>
                        <p>
                          Il diff{" "}
                          {snapshot.files.some((f) => f.staged)
                            ? "dei file nello staging"
                            : "delle modifiche non preparate"}{" "}
                          verrà inviato al profilo “{selectedProfile.name}”
                          usando {model || "il modello scelto"}.
                          {selectedProfile.provider === "litellm"
                            ? " Il gateway può inoltrare i dati a servizi cloud."
                            : ""}
                        </p>
                      </div>
                    </div>
                  )}
                  {aiState && <p className="tools-hint">{aiState}</p>}
                  <label>
                    Richiesta
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
                    Genera suggerimento
                  </button>
                </>
              ) : (
                <div className="tools-ai-load">
                  <Settings2 size={18} />
                  <span>Nessun profilo AI configurato.</span>
                  {onOpenAISettings && (
                    <button onClick={onOpenAISettings}>
                      Configura un provider
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
          {busy && <p className="tools-hint">Operazione in corso…</p>}
          {result && (
            <div className="tools-output">
              <header>
                <span>Risultato</span>
                <button onClick={() => navigator.clipboard.writeText(result)}>
                  <Copy size={13} />
                  Copia
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
