# A shipped plugin's web half joins the Web App at build time, through slots

- **Date:** 2026-11-19
- **Type:** refactor
- **Scope:** `web`, `web-plugin`, `server`, `ui-gallery`
- **PR:** [#1648](https://github.com/Prism-Shadow/penguin-harness/pull/1648)

[中文版](2026-11-19-plugin-web-seams.zh.md)

A plugin shipped with the build can now carry its own UI: a `./web` export pointing at TypeScript under its `src/web/`, compiled with the Web App, which boots its modules beside the app's own (penguin-harness-design [#489](https://github.com/Prism-Shadow/penguin-harness-design/pull/489)). The agent browser's web half reaches the app only that way now, through the new seams below, so it can move into its plugin unchanged. Nothing on screen changes.

## Details

- `gen:ifaces` of the Web App (`scripts/gen-web-table.mjs`) writes the generated list of the web halves among its dependencies (`src/plugin-web.gen.ts`, not committed) and reads each one's `tsconfig.web.json` into the app's own interface table; `bootWeb()` boots every listed module as one more child of the root. Tailwind scans `plugins/*/src/web`.
- New private package `@prismshadow/penguin-web-plugin`: the only part of the app a web half imports. The app hands it its own `apiFetch`, `ApiError`, failure and toast helpers, Settings request, dock operations, date format and tone maps before it boots (`web-app/plugin-host.ts`); `defineStrings` gives a plugin's own zh and en tables that follow the language on screen, and their `apiErrors` are read after the app's own codes.
- New slots: `SettingsModule.sections` (a Settings page among the app's own, by its order), `ChatModule.sessionHandovers` (what moves when a conversation takes a new id), `ChatModule.linkActions` (rows before the app's own in a web link's menu), `DockModule.scopeListeners` and `DockModule.layoutListeners`, `lead` on `DockModule.panels` data (first in an empty dock's picker), and `WebAppModule.serverModules`.
- A web module that declares its server module in `WebAppModule.serverModules` is drawn — layers, dock panel, Settings pages, link rows — only while `GET /api/contributions` lists that module in its new `modules` field: the server modules plugins run in this generation.
- The agent browser contributes its two Settings pages, its link row, its draft-to-Session handover, its scope and full-screen listeners, and its picker lead through those slots; its strings, endpoint wrappers, start sites, import route and ring stylesheet moved into `features/builtin-browser/`. The gallery's mock coverage check walks its endpoint wrappers too.
