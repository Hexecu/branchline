/* Copyright (C) 2026 Davide Leopardi
 * SPDX-License-Identifier: GPL-3.0-only */

import React, { useMemo } from "react";
import { Copy } from "lucide-react";
import { useI18n } from "./i18n";
const emojiAliases: Record<string, string> = {
  arrow_up: "⬆️",
  arrow_down: "⬇️",
  sparkles: "✨",
  sparkle: "✨",
  bug: "🐛",
  ambulance: "🚑",
  fire: "🔥",
  art: "🎨",
  zap: "⚡",
  memo: "📝",
  pencil: "📝",
  pencil2: "✏️",
  rocket: "🚀",
  white_check_mark: "✅",
  heavy_check_mark: "✔️",
  lock: "🔒",
  closed_lock_with_key: "🔐",
  construction: "🚧",
  construction_worker: "👷",
  recycle: "♻️",
  wrench: "🔧",
  hammer: "🔨",
  hammer_and_wrench: "🛠️",
  package: "📦",
  tada: "🎉",
  boom: "💥",
  lipstick: "💄",
  rotating_light: "🚨",
  green_heart: "💚",
  heart: "❤️",
  alien: "👽",
  truck: "🚚",
  page_facing_up: "📄",
  bookmark: "🔖",
  books: "📚",
  book: "📖",
  bulb: "💡",
  globe_with_meridians: "🌐",
  loud_sound: "🔊",
  mute: "🔇",
  wheelchair: "♿",
  children_crossing: "🚸",
  building_construction: "🏗️",
  chart_with_upwards_trend: "📈",
  chart_with_downwards_trend: "📉",
  pushpin: "📌",
  test_tube: "🧪",
  mag: "🔍",
  mag_right: "🔎",
  rewind: "⏪",
  twisted_rightwards_arrows: "🔀",
  arrows_counterclockwise: "🔄",
  triangular_flag_on_post: "🚩",
  label: "🏷️",
  safety_vest: "🦺",
  wastebasket: "🗑️",
  coffin: "⚰️",
  seedling: "🌱",
  goal_net: "🥅",
  bento: "🍱",
  technologist: "🧑‍💻",
  speech_balloon: "💬",
  camera_flash: "📸",
  see_no_evil: "🙈",
  ok_hand: "👌",
};
export function displayCommitText(text: string) {
  return text.replace(/:([a-z0-9_+-]+):/g, (original, key: string) =>
    Object.hasOwn(emojiAliases, key) ? emojiAliases[key] : original,
  );
}
function safeLink(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function inline(
  text: string,
  onOpenLink: (url: string) => void,
): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  const pattern =
    /(`[^`\n]+`|\[[^\[\]\n]+\]\([^\s)]+\)|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|_[^_\n]+_|https:\/\/[^\s<>]+)/g;
  let from = 0,
    match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > from)
      result.push(displayCommitText(text.slice(from, match.index)));
    const token = match[0],
      key = match.index;
    if (token.startsWith("`"))
      result.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (token.startsWith("[")) {
      const parts = /^\[([^\[\]]+)\]\(([^)]+)\)$/.exec(token);
      const url = parts && safeLink(parts[2]);
      result.push(
        url ? (
          <a
            key={key}
            href={url}
            rel="noopener noreferrer"
            onClick={(e) => {
              e.preventDefault();
              onOpenLink(url);
            }}
          >
            {displayCommitText(parts![1])}
          </a>
        ) : (
          displayCommitText(token)
        ),
      );
    } else if (token.startsWith("**") || token.startsWith("__"))
      result.push(
        <strong key={key}>{displayCommitText(token.slice(2, -2))}</strong>,
      );
    else if (token.startsWith("~~"))
      result.push(<del key={key}>{displayCommitText(token.slice(2, -2))}</del>);
    else if (token.startsWith("*") || token.startsWith("_"))
      result.push(<em key={key}>{displayCommitText(token.slice(1, -1))}</em>);
    else {
      const clean = token.replace(/[.,;!]+$/, "");
      const url = safeLink(clean);
      result.push(
        url ? (
          <React.Fragment key={key}>
            <a
              href={url}
              rel="noopener noreferrer"
              onClick={(e) => {
                e.preventDefault();
                onOpenLink(url);
              }}
            >
              {clean}
            </a>
            {token.slice(clean.length)}
          </React.Fragment>
        ) : (
          token
        ),
      );
    }
    from = pattern.lastIndex;
  }
  if (from < text.length) result.push(displayCommitText(text.slice(from)));
  return result;
}
export default function CommitMarkdown({
  text,
  onOpenLink,
  onCopy,
}: {
  text: string;
  onOpenLink: (url: string) => void;
  onCopy?: (text: string) => void;
}) {
  const { t, language } = useI18n();
  const blocks = useMemo(() => {
    if (text.length > 200000)
      return [
        <p key="large-note" className="markdown-large-note">
          {t(
            "Messaggio molto esteso: mostrato come testo originale per mantenere l’interfaccia reattiva.",
          )}
        </p>,
        <pre key="large-text" className="commit-message-raw">
          {text}
        </pre>,
      ];
    const lines = text.replace(/\r\n/g, "\n").split("\n"),
      nodes: React.ReactNode[] = [];
    let i = 0;
    const special = (l: string) =>
      /^(?:\s*```|\s*~~~|#{1,6}\s|\s*[-*+]\s|\s*\d+[.)]\s|>\s?|\s*[-*_]{3,}\s*$)/.test(
        l,
      );
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        i++;
        continue;
      }
      const fence = /^\s*(```|~~~)([^\s]*)/.exec(line);
      if (fence) {
        const start = i++,
          contents: string[] = [];
        while (i < lines.length && !lines[i].trim().startsWith(fence[1]))
          contents.push(lines[i++]);
        if (i < lines.length) i++;
        const code = contents.join("\n");
        nodes.push(
          <div className="commit-code-block" key={start}>
            <div>
              <span>{fence[2] || t("Codice")}</span>
              {onCopy && (
                <button title={t("Copia codice")} onClick={() => onCopy(code)}>
                  <Copy size={12} />
                </button>
              )}
            </div>
            <pre>
              <code>{code}</code>
            </pre>
          </div>,
        );
        continue;
      }
      const heading = /^(#{1,6})\s+(.+)$/.exec(line);
      if (heading) {
        nodes.push(
          <h4
            className={`markdown-heading heading-${heading[1].length}`}
            key={i++}
          >
            {inline(heading[2], onOpenLink)}
          </h4>,
        );
        continue;
      }
      if (/^\s*[-*_]{3,}\s*$/.test(line)) {
        nodes.push(<hr key={i++} />);
        continue;
      }
      if (/^>\s?/.test(line)) {
        const start = i,
          quotes: string[] = [];
        while (i < lines.length && /^>\s?/.test(lines[i]))
          quotes.push(lines[i++].replace(/^>\s?/, ""));
        nodes.push(
          <blockquote key={start}>
            {inline(quotes.join("\n"), onOpenLink)}
          </blockquote>,
        );
        continue;
      }
      const list = /^(\s*)([-*+]|\d+[.)])\s+(.+)$/.exec(line);
      if (list) {
        const start = i,
          ordered = /\d/.test(list[2]),
          items: React.ReactNode[] = [];
        while (i < lines.length) {
          const entry = /^\s*([-*+]|\d+[.)])\s+(.+)$/.exec(lines[i]);
          if (!entry || /\d/.test(entry[1]) !== ordered) break;
          const task = /^\[([ xX])\]\s+(.*)$/.exec(entry[2]);
          items.push(
            <li key={i++}>
              {task ? (
                <>
                  <span
                    className={`markdown-task ${task[1].toLowerCase() === "x" ? "checked" : ""}`}
                    aria-label={
                      task[1].toLowerCase() === "x"
                        ? "Completato"
                        : "Da completare"
                    }
                  >
                    {task[1].toLowerCase() === "x" ? "✓" : "□"}
                  </span>
                  {inline(task[2], onOpenLink)}
                </>
              ) : (
                inline(entry[2], onOpenLink)
              )}
            </li>,
          );
        }
        nodes.push(
          ordered ? (
            <ol key={start} start={parseInt(list[2], 10)}>
              {items}
            </ol>
          ) : (
            <ul key={start}>{items}</ul>
          ),
        );
        continue;
      }
      const start = i,
        paragraph = [lines[i++]];
      while (i < lines.length && lines[i].trim() && !special(lines[i]))
        paragraph.push(lines[i++]);
      nodes.push(<p key={start}>{inline(paragraph.join("\n"), onOpenLink)}</p>);
    }
    return nodes;
  }, [text, onOpenLink, onCopy, t, language]);
  return <div className="commit-markdown">{blocks}</div>;
}
