# Plugin-contributed languages, and an index beyond the builtin one

- **Date:** 2026-08-27
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`
- **PR:** [#526](https://github.com/Prism-Shadow/penguin-harness/pull/526)

[中文版](2026-08-27-extension-languages.zh.md)

A plugin can contribute a syntax-highlighting grammar, and the Plugins page lists more than what the server package ships with. This repository carries only the contribution point. The first language plugin, for Typst, Swift, Kotlin, C# and Dart, lives in its own repository, [Myriad-Dreamin/penguin-plugin-languages](https://github.com/Myriad-Dreamin/penguin-plugin-languages), as an external plugin.

## Details

- **Contribution point:** a plugin contributes `{language, displayName, aliases?, extensions?}` together with its TextMate grammar through the `LanguagesModule.grammars` slot. The types, `LanguageContribution` and `LanguageGrammar`, are in `@prismshadow/penguin-core/plugin`. The service that stores and serves the grammars is built with each App, so a language whose plugin is no longer loaded stops being served.
- **Endpoints:**
  - `GET /api/languages` lists the contributed languages without their grammars.
  - `GET /api/languages/:id/grammar` serves one grammar, cached for an hour.
  - The App receives aliases and file extensions before the grammar, because the fence info string decides whether a grammar is loaded at all. A code block already on screen re-highlights when its grammar arrives.
- **Grammars are data:** a contributed language cannot shadow a bundled one, by id or by alias. A grammar is a document that Shiki's JavaScript regex engine interprets, so nothing a plugin ships is evaluated on this path. A grammar that relies on an oniguruma-only construct fails to compile, and its blocks render unhighlighted.
- **Published index:** `GET /api/plugins/registry` merges the published index with the entries the server package embeds and answers `{plugins, failures}`.
  - The published index is a release asset on a fixed tag (`releases/download/nightly/index.json`). It is fetched at most every 30 minutes; concurrent readers share one request, and the last good document is served when a refresh fails.
  - A source that cannot be read is named in `failures` and shortens the listing rather than emptying it. Within one document, a malformed row still fails that whole document.
  - On a `name@version` collision the builtin entry wins.
  - `PENGUIN_PLUGIN_INDEX=off` turns the lookup off with no outbound request; any other value replaces the URL.
