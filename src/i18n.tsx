import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  LANGUAGES,
  normalizeLanguage,
  getLocale,
  translate,
  formatNumber as numberFor,
  formatDate as dateFor,
  formatRelativeDate as relativeFor,
} from "../locales/runtime.mjs";
import type {
  Language,
  TranslateParams,
  Translator,
} from "../locales/runtime.mjs";

export {
  LANGUAGES,
  normalizeLanguage,
  getLocale,
} from "../locales/runtime.mjs";
export type {
  Language,
  TranslateParams,
  Translator,
} from "../locales/runtime.mjs";

export interface I18nContextValue {
  language: Language;
  locale: string;
  t: Translator;
  setLanguage: (next: string) => Promise<void>;
  formatNumber: (
    value: number | bigint,
    options?: Intl.NumberFormatOptions,
  ) => string;
  formatDate: (
    value: Date | string | number,
    options?: Intl.DateTimeFormatOptions,
  ) => string;
  formatRelativeDate: (
    value: Date | string | number,
    now?: Date | string | number,
  ) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, updateLanguage] = useState<Language>("en");
  const activeLanguage = useRef<Language>(language);
  activeLanguage.current = language;
  const persistedLanguage = useRef<Language>("en");
  const revision = useRef(0),
    bootstrapRequest = useRef<Promise<void>>(Promise.resolve()),
    writes = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    let active = true;
    if (typeof window !== "undefined" && window.branchline) {
      bootstrapRequest.current = window.branchline
        .invoke<{ settings?: { language?: string } }>("app.bootstrap")
        .then((bootstrap) => {
          if (active) {
            const saved = normalizeLanguage(bootstrap.settings?.language);
            persistedLanguage.current = saved;
            if (revision.current === 0) updateLanguage(saved);
          }
        })
        .catch(() => {
          /* App owns the bootstrap error surface; retain English here. */
        });
    }
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = language;
      document.documentElement.dir = "ltr";
      document.documentElement.dataset.language = language;
    }
  }, [language]);
  const t = useCallback(
    (key: string, params?: TranslateParams) =>
      translate(activeLanguage.current, key, params),
    [],
  );
  const formatNumber = useCallback(
    (value: number | bigint, options?: Intl.NumberFormatOptions) =>
      numberFor(activeLanguage.current, value, options),
    [],
  );
  const formatDate = useCallback(
    (value: Date | string | number, options?: Intl.DateTimeFormatOptions) =>
      dateFor(activeLanguage.current, value, options),
    [],
  );
  const formatRelativeDate = useCallback(
    (value: Date | string | number, now?: Date | string | number) =>
      relativeFor(activeLanguage.current, value, now),
    [],
  );
  const setLanguage = useCallback(async (input: string) => {
    const next = normalizeLanguage(input),
      token = ++revision.current;
    activeLanguage.current = next;
    updateLanguage(next);
    const persist = writes.current
      .catch(() => {})
      .then(async () => {
        await bootstrapRequest.current;
        if (typeof window !== "undefined" && window.branchline)
          await window.branchline.invoke("app.settings", {
            settings: { language: next },
          });
        persistedLanguage.current = next;
      });
    writes.current = persist;
    try {
      await persist;
    } catch (error) {
      if (token === revision.current) {
        activeLanguage.current = persistedLanguage.current;
        updateLanguage(persistedLanguage.current);
      }
      throw new Error(
        translate(activeLanguage.current, "Impossibile salvare la lingua."),
        { cause: error },
      );
    }
  }, []);
  const value = useMemo(
    () => ({
      language,
      locale: getLocale(language),
      t,
      setLanguage,
      formatNumber,
      formatDate,
      formatRelativeDate,
    }),
    [language, t, setLanguage, formatNumber, formatDate, formatRelativeDate],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n requires I18nProvider.");
  return context;
}
