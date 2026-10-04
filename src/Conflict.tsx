/* Copyright (C) 2026 Davide Leopardi
 * SPDX-License-Identifier: GPL-3.0-only */

import { useEffect, useState } from "react";
import { X, GitMerge, ArrowDown, Check, LoaderCircle } from "lucide-react";
import type { Snapshot } from "./types";
import { useI18n } from "./i18n";
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
  const { t, formatNumber } = useI18n();
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
    [error, setError] = useState(""),
    [validationError, setValidationError] = useState(false);
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
      .catch((e) => {
        if (active) {
          setValidationError(false);
          setError(e.message);
        }
      });
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
      setValidationError(true);
      return;
    }
    setBusy(true);
    setError("");
    setValidationError(false);
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
        aria-label={t("Editor conflitti")}
      >
        <header>
          <GitMerge size={22} />
          <div>
            <h2>{t("Risolvi il conflitto")}</h2>
            <p>
              {file} <span>· {snapshot.operation}</span>
            </p>
          </div>
          <button onClick={onClose} aria-label={t("Chiudi editor conflitti")}>
            <X size={20} />
          </button>
        </header>
        {versions ? (
          <>
            <div className="conflict-sources">
              <section>
                <header>
                  <strong>{t("OURS · versione corrente")}</strong>
                  <button
                    onClick={() => {
                      setContent(versions.ours);
                      setRemove(!versions.present.ours);
                    }}
                  >
                    <ArrowDown size={13} />
                    {versions.present.ours
                      ? t("Usa questa")
                      : t("Mantieni eliminazione")}
                  </button>
                </header>
                <pre>
                  {versions.present.ours
                    ? versions.ours || t("(File vuoto)")
                    : t("(File eliminato in questa versione)")}
                </pre>
              </section>
              <section>
                <header>
                  <strong>{t("THEIRS · versione in arrivo")}</strong>
                  <button
                    onClick={() => {
                      setContent(versions.theirs);
                      setRemove(!versions.present.theirs);
                    }}
                  >
                    <ArrowDown size={13} />
                    {versions.present.theirs
                      ? t("Usa questa")
                      : t("Mantieni eliminazione")}
                  </button>
                </header>
                <pre>
                  {versions.present.theirs
                    ? versions.theirs || t("(File vuoto)")
                    : t("(File eliminato in questa versione)")}
                </pre>
              </section>
            </div>
            <div className="conflict-notice">
              {snapshot.operation === "rebase"
                ? t(
                    "Durante un rebase, OURS è la nuova base e THEIRS è il commit che stai riapplicando.",
                  )
                : t(
                    "Puoi scegliere una versione completa oppure combinare il contenuto nell’editor.",
                  )}
            </div>
            <div className="conflict-result">
              <header>
                <strong>
                  {remove
                    ? t("RISULTATO · file eliminato")
                    : t("RISULTATO · modifica e verifica")}
                </strong>
                <span>
                  {t(
                    content.split("\n").length === 1
                      ? "{count} riga"
                      : "{count} righe",
                    { count: formatNumber(content.split("\n").length) },
                  )}
                </span>
              </header>
              <textarea
                aria-label={t("Contenuto risolto")}
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
              {t("Caricamento versioni…")}
            </p>
          )
        )}
        {error && (
          <div className="tools-error" role="alert">
            {validationError
              ? t(
                  "Rimuovi tutti i marcatori di conflitto prima di preparare il file.",
                )
              : error}
          </div>
        )}
        <footer>
          <span>
            {remove
              ? t("L’eliminazione del file viene aggiunta allo staging.")
              : t("Il file viene salvato e aggiunto allo staging.")}
          </span>
          <button onClick={onClose}>{t("Annulla")}</button>
          <button
            className="conflict-save"
            disabled={busy || !versions}
            onClick={() => void save()}
          >
            <Check size={15} />
            {busy ? t("Salvataggio…") : t("Salva e prepara")}
          </button>
        </footer>
      </section>
    </div>
  );
}
