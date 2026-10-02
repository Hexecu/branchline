# Interface languages

Branchline provides English, Italian, Spanish, French, German, Brazilian Portuguese, Japanese and Simplified Chinese. A new installation starts in English; an existing saved Italian preference remains Italian.

Open **Preferences → Interface language**, or use the language button in the header. Select a language to apply and save it immediately. Other preferences still use the Save button. The setting belongs to this local installation and survives a restart. A failed save reports an error and restores the last saved language.

Interface labels, command descriptions and native menus use the selected language. Dates and numbers use its `Intl` locale. Branch names, repository paths, commit messages, file contents, model identifiers, shell output and messages returned by Git or external services retain their original text. Language selection does not change repository configuration or send data to a translation service.

Japanese and Chinese use available system fonts. Longer labels can wrap; no font files or remote translation resources are downloaded. Native layout validation is recorded separately in [VALIDATION.md](VALIDATION.md); automated catalog coverage is not proof that every screen was exercised in every language.

## Contributing translations

The shared [runtime](../locales/runtime.mjs) loads five catalogs: [core](../locales/core.json), [settings](../locales/settings.json), [Git tools](../locales/git-tools.json), [actions/native menus](../locales/actions.json) and [recovery/message details](../locales/extra.json). Each language maps an Italian source key to a complete translated template. Italian uses the source key directly. Preserve named placeholders such as `{branch}` and `{count}`; translate the complete sentence, including its punctuation, rather than concatenating fragments.

Use `t(key, params)` for interface text and `useI18n()` in React components. Interpolation produces plain text. Pass repository content as parameters and keep it unchanged. Translator and formatter functions have stable identities; memoized translated data must also depend on `language`.

`npm test` checks all seven translated catalogs, placeholder agreement, static translation calls, safe interpolation and locale formatting. An unknown language falls back to English. A missing translation falls back to English and then the original source key; catalog tests prevent shipping known gaps.
