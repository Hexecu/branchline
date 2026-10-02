export type Language =
  "en" | "it" | "es" | "fr" | "de" | "pt-BR" | "ja" | "zh-CN";
export type TranslateParams = Record<string, string | number>;
export type Translator = (key: string, params?: TranslateParams) => string;
export interface LanguageMetadata {
  readonly code: Language;
  readonly nativeName: string;
  readonly name: string;
  readonly locale: string;
}
export const LANGUAGES: readonly LanguageMetadata[];
export function normalizeLanguage(input: unknown): Language;
export function getLocale(language: unknown): string;
export function translate(
  language: unknown,
  key: string,
  params?: TranslateParams,
): string;
export function createTranslator(language: unknown): Translator;
export function formatNumber(
  language: unknown,
  value: number | bigint,
  options?: Intl.NumberFormatOptions,
): string;
export function formatDate(
  language: unknown,
  value: Date | string | number,
  options?: Intl.DateTimeFormatOptions,
): string;
export function formatRelativeDate(
  language: unknown,
  value: Date | string | number,
  now?: Date | string | number,
): string;
