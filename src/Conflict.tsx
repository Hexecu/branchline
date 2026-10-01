import { useEffect, useState } from "react";
import { X, GitMerge, ArrowDown, Check, LoaderCircle } from "lucide-react";
import type { Snapshot } from "./types";
import "./conflict.css";
export default function ConflictPanel({
  snapshot,
  file,
  onClose,
  onResolved,
}: {
  snapshot: Snapshot;
  file: string;
  onClose: () => void;
  onResolved: () => void;
}) {
  const [versions, setVersions] = useState<{
      base: string;
      ours: string;
      theirs: string;
      working: string;
      present: {
        base: boolean;
        ours: boolean;
        theirs: boolean;
        working: boolean;
      };
    } | null>(null),
    [content, setContent] = useState(""),
    [remove, setRemove] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    window.branchline
      .invoke<any>("repo.conflictVersions", { path: snapshot.path, file })
      .then((v) => {
        if (active) {
          setVersions(v);
          setContent(v.working);
        }
      })
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [snapshot.path, file]);
  async function save() {
    if (
      content
        .split("\n")
        .some((l) => /^(<<<<<<< |=======\s*$|>>>>>>> )/.test(l))
    ) {
      setError(
        "Rimuovi tutti i marcatori di conflitto prima di preparare il file.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      await window.branchline.invoke("repo.action", {
        path: snapshot.path,
        operation: "conflict.resolve",
        file,
        content,
        remove,
      });
      onResolved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="conflict-backdrop">
      <section
        className="conflict-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Editor conflitti"
      >
        <header>
          <GitMerge size={22} />
          <div>
            <h2>Risolvi il conflitto</h2>
            <p>
              {file} <span>· {snapshot.operation}</span>
            </p>
          </div>
          <button onClick={onClose} aria-label="Chiudi editor conflitti">
            <X size={20} />
          </button>
        </header>
        {versions ? (
          <>
            <div className="conflict-sources">
              <section>
                <header>
                  <strong>OURS · versione corrente</strong>
                  <button
                    onClick={() => {
                      setContent(versions.ours);
                      setRemove(!versions.present.ours);
                    }}
                  >
                    <ArrowDown size={13} />
                    {versions.present.ours
                      ? "Usa questa"
                      : "Mantieni eliminazione"}
                  </button>
                </header>
                <pre>
                  {versions.present.ours
                    ? versions.ours || "(File vuoto)"
                    : "(File eliminato in questa versione)"}
                </pre>
              </section>
              <section>
                <header>
                  <strong>THEIRS · versione in arrivo</strong>
                  <button
                    onClick={() => {
                      setContent(versions.theirs);
                      setRemove(!versions.present.theirs);
                    }}
                  >
                    <ArrowDown size={13} />
                    {versions.present.theirs
                      ? "Usa questa"
                      : "Mantieni eliminazione"}
                  </button>
                </header>
                <pre>
                  {versions.present.theirs
                    ? versions.theirs || "(File vuoto)"
                    : "(File eliminato in questa versione)"}
                </pre>
              </section>
            </div>
            <div className="conflict-notice">
              {snapshot.operation === "rebase"
                ? "Durante un rebase, OURS è la nuova base e THEIRS è il commit che stai riapplicando."
                : "Puoi scegliere una versione completa oppure combinare il contenuto nell’editor."}
            </div>
            <div className="conflict-result">
              <header>
                <strong>
                  {remove
                    ? "RISULTATO · file eliminato"
                    : "RISULTATO · modifica e verifica"}
                </strong>
                <span>{content.split("\n").length} righe</span>
              </header>
              <textarea
                aria-label="Contenuto risolto"
                spellCheck={false}
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                  setRemove(false);
                }}
              />
            </div>
          </>
        ) : (
          !error && (
            <p>
              <LoaderCircle className="spin" />
              Caricamento versioni…
            </p>
          )
        )}
        {error && (
          <div className="tools-error" role="alert">
            {error}
          </div>
        )}
        <footer>
          <span>
            {remove
              ? "L’eliminazione del file viene aggiunta allo staging."
              : "Il file viene salvato e aggiunto allo staging."}
          </span>
          <button onClick={onClose}>Annulla</button>
          <button
            className="conflict-save"
            disabled={busy || !versions}
            onClick={() => void save()}
          >
            <Check size={15} />
            {busy ? "Salvataggio…" : "Salva e prepara"}
          </button>
        </footer>
      </section>
    </div>
  );
}
