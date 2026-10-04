/* Copyright (C) 2026 Davide Leopardi
 * SPDX-License-Identifier: GPL-3.0-only */

import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { X, TerminalSquare } from "lucide-react";
import { useI18n } from "./i18n";
import "@xterm/xterm/css/xterm.css";
export default function TerminalPanel({
  path,
  onClose,
}: {
  path: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const translation = useRef(t);
  translation.current = t;
  const mount = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!mount.current) return;
    let id = "",
      disposed = false;
    const term = new Terminal({
      fontFamily: '"SFMono-Regular", Menlo, monospace',
      fontSize: 12,
      cursorBlink: true,
      theme: {
        background: "#10141a",
        foreground: "#d4dae6",
        cursor: "#70dfbd",
        selectionBackground: "#374954",
      },
      convertEol: false,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(mount.current);
    fit.fit();
    const queue: Array<{ id: string; data: string }> = [];
    const offData = window.branchline.on("terminal.data", (p) => {
      if (!id) queue.push(p);
      else if (p.id === id) term.write(p.data);
    });
    const offExit = window.branchline.on("terminal.exit", (p) => {
      if (p.id === id)
        term.writeln(
          "\r\n\x1b[90m" +
            translation.current("Sessione terminata ({code}).", {
              code: String(p.code ?? "—"),
            }) +
            "\x1b[0m",
        );
    });
    const data = term.onData((text) => {
      if (id)
        window.branchline
          .invoke("terminal.write", { id, data: text })
          .catch(() => {});
    });
    const observer = new ResizeObserver(() => {
      if (disposed) return;
      fit.fit();
      if (id)
        window.branchline
          .invoke("terminal.resize", { id, cols: term.cols, rows: term.rows })
          .catch(() => {});
    });
    observer.observe(mount.current);
    window.branchline
      .invoke<{ id: string }>("terminal.open", { path })
      .then((p) => {
        if (disposed) {
          window.branchline.invoke("terminal.close", { id: p.id });
          return;
        }
        id = p.id;
        for (const q of queue) if (q.id === id) term.write(q.data);
        window.branchline.invoke("terminal.resize", {
          id,
          cols: term.cols,
          rows: term.rows,
        });
        term.focus();
      })
      .catch((e) => setError(e.message));
    return () => {
      disposed = true;
      observer.disconnect();
      offData();
      offExit();
      data.dispose();
      term.dispose();
      if (id)
        window.branchline.invoke("terminal.close", { id }).catch(() => {});
    };
  }, [path]);
  return (
    <section
      className="terminal-panel"
      style={{
        height: 240,
        background: "#10141a",
        borderTop: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 14px",
          color: "#c8d0dd",
          fontSize: 12,
        }}
      >
        <TerminalSquare size={14} />
        <strong>{t("Terminale")}</strong>
        <span
          style={{
            opacity: 0.5,
            flex: 1,
            minWidth: 0,
            overflowWrap: "anywhere",
          }}
        >
          {path}
        </span>
        <button onClick={onClose} aria-label={t("Chiudi terminale")}>
          <X size={15} />
        </button>
      </header>
      {error ? (
        <p className="error">{error}</p>
      ) : (
        <div
          ref={mount}
          style={{ flex: 1, minHeight: 0, padding: "0 14px 10px" }}
        />
      )}
    </section>
  );
}
export { TerminalPanel };
