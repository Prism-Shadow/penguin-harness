# Remove bundled Chinese translations

- **Date:** 2026-09-19
- **Type:** refactor
- **Scope:** `web`, `cli`, `desktop`, `docs`, `tooling`
- **PR:** [#11](https://github.com/nicolaepocroianu/penguin-harness/pull/11)

Removed Chinese UI catalogs, translated documentation and changelogs, localized media, and bundled plugin metadata. Removed Chinese options from the app and site language menus and retained the dictionary contract and locale providers for future translations.

Contributor guides and changelog instructions now require English only. Built-in organization instructions and messaging notices use English while user content, organization working-language settings, and Unicode input support remain available. Unsupported saved UI language preferences use the existing default-language fallback.
