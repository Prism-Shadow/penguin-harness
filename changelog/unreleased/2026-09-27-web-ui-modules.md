# Web App modules: the terminal owns its copy, its entry and its tests

- **Date:** 2026-09-27
- **Type:** refactor
- **Scope:** `web`, `skills`

[中文版](2026-09-27-web-ui-modules.zh.md)

Introduced Web App modules — a feature directory with a public entry, its own zh/en dictionary fragments and a test project of its own — and made the terminal the first one. No user-visible text or behaviour changed.

## Details

- Moved the terminal's copy out of both app dictionaries into the terminal's own fragments, which the dictionaries now mount by reference; components still read `S.terminal.*`. The two shell-kill confirmation strings moved from the dock section to the terminal's.
- Routed every import of the terminal from outside its directory (the router, the app shell, the chat page, the session surface view and three dock files) through the module's entry.
- Added a module manifest to the Web package's tests; the vitest config derives one project per module, so `vitest run --project terminal` runs the terminal's tests alone, and a boundary test fails on an import that goes around a module's entry or outside its declared dependencies.
- Moved the terminal-link, touch key bar, socket and touch-scroll unit tests into the module and added tests for the terminal's dictionary fragments.
