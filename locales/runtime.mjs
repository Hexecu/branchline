/* Copyright (C) 2026 Davide Leopardi
 * SPDX-License-Identifier: GPL-3.0-only */

import languages from "./languages.json" with { type: "json" };
import core from "./core.json" with { type: "json" };
import settings from "./settings.json" with { type: "json" };
import gitTools from "./git-tools.json" with { type: "json" };
import actions from "./actions.json" with { type: "json" };
import extra from "./extra.json" with { type: "json" };

export const LANGUAGES = Object.freeze(
  languages.map((item) => Object.freeze({ ...item })),
);
const catalogs = [core, settings, gitTools, actions, extra];
const languageCodes = new Map(
  LANGUAGES.map((item) => [item.code.toLowerCase(), item.code]),
);

export function normalizeLanguage(input) {
  if (typeof input !== "string") return "en";
  const key = input.trim().replaceAll("_", "-").toLowerCase();
  if (languageCodes.has(key)) return languageCodes.get(key);
  if (/^(en|it|es|fr|de|ja)(?:-[a-z\d]+)*$/.test(key)) return key.split("-")[0];
  if (/^pt(?:-br)?$/.test(key)) return "pt-BR";
  if (/^zh(?:-hans)?(?:-cn)?$/.test(key)) return "zh-CN";
  return "en";
}

export function getLocale(language) {
  return LANGUAGES.find((item) => item.code === normalizeLanguage(language))
    .locale;
}

function lookup(language, key) {
  for (const catalog of catalogs) {
    const dictionary = catalog[language];
    if (
      dictionary &&
      Object.hasOwn(dictionary, key) &&
      typeof dictionary[key] === "string"
    )
      return dictionary[key];
  }
  return undefined;
}

export function translate(language, key, params) {
  const source = String(key ?? "");
  const code = normalizeLanguage(language);
  const template =
    code === "it"
      ? source
      : (lookup(code, source) ?? lookup("en", source) ?? source);
  return template.replace(
    /\{([a-zA-Z_][a-zA-Z\d_]*)\}/g,
    (placeholder, name) => {
      if (!params || !Object.hasOwn(params, name)) return placeholder;
      const value = params[name];
      return typeof value === "string" || typeof value === "number"
        ? String(value)
        : placeholder;
    },
  );
}

export function createTranslator(language) {
  const code = normalizeLanguage(language);
  return (key, params) => translate(code, key, params);
}

const numberFormats = new Map();
const dateFormats = new Map();
const relativeFormats = new Map();
function formatter(cache, Type, language, options = {}) {
  const locale = getLocale(language);
  const key = locale + JSON.stringify(options);
  if (!cache.has(key)) {
    if (cache.size >= 128) cache.clear();
    cache.set(key, new Type(locale, options));
  }
  return cache.get(key);
}
function dateValue(value) {
  return value instanceof Date ? new Date(value.getTime()) : new Date(value);
}
export function formatNumber(language, value, options) {
  return formatter(numberFormats, Intl.NumberFormat, language, options).format(
    value,
  );
}
export function formatDate(
  language,
  value,
  options = { day: "numeric", month: "short", year: "numeric" },
) {
  const date = dateValue(value);
  if (!Number.isFinite(date.getTime()))
    return typeof value === "string" ? value : "—";
  return formatter(dateFormats, Intl.DateTimeFormat, language, options).format(
    date,
  );
}
export function formatRelativeDate(language, value, now = new Date()) {
  const date = dateValue(value),
    reference = dateValue(now);
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(reference.getTime()))
    return formatDate(language, value);
  const calendarDay = (item) =>
    Date.UTC(item.getFullYear(), item.getMonth(), item.getDate());
  const days = Math.round(
    (calendarDay(date) - calendarDay(reference)) / 86400000,
  );
  if (Math.abs(days) < 7)
    return formatter(relativeFormats, Intl.RelativeTimeFormat, language, {
      numeric: "auto",
    }).format(days, "day");
  return formatDate(language, date);
}
