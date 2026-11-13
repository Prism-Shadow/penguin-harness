# The model catalog moves from core to the server

- **Date:** 2026-10-15
- **Type:** refactor
- **Scope:** `core`, `server`, `web`, `cli`, `model-catalog`
- **PR:** [#1167](https://github.com/Prism-Shadow/penguin-harness/pull/1167)
- **Breaking:** yes — `@prismshadow/penguin-core/model-catalog` is removed, and core's default Project config carries no models

[中文版](2026-10-15-model-catalog-server.zh.md)

The built-in model catalog moved from `packages/core` to `packages/server`. It covers the model rows, the provider groups, pricing and off-peak rules, presets and their sync helpers, and the UI helpers. Core now special-cases no model, provider or gateway; the one exception is the gateway attribution headers.

## Where things are

- The catalog is `packages/server/src/model-catalog/`, published as the browser-safe subpath `@prismshadow/penguin-server/model-catalog`. The Web App, the CLI and the component gallery import it from there. Its runtime imports are core's `@prismshadow/penguin-core/model-connection` and MMSP's `@prismshadow/mmsp/credentials`, which the server now depends on. It is split by concern: the catalog data and lookups, what the UI shows about MMSP's clients (MMSP's routing passed through, each client's request path and fast-mode protocol), the environment variable names a model reads (asked of MMSP), and the Project seed.
- Core's `@prismshadow/penguin-core/model-catalog` subpath and the catalog's re-export from the core root were removed.
- `attributionHeaders` (OpenRouter, TokenDance, OpenCode's `x-opencode-session`) moved into core's own App attribution module, `llm/app-attribution.ts`, whose headers `GenerativeModel` attaches to every request. `APP_URL` is exported from the core root.

## Seeding the Project config

- The server writes a new Project's file from the catalog: the default model (`PRESET_DEFAULT_MODEL`, still `deepseek/deepseek-flash`), each built-in group's `[providers.<id>]` table (none for the first-party groups), and the preset rows. **Restore defaults** and the onboarding backfill write the same seed.
- Core's `defaultProjectConfig()` carries the factory command policy and no providers, models or default model. `loadProjectConfig` returns it for a missing file.

## Migrations

The Penguin Go route migration (`migratePenguinGoRoutes`) moved from core's `loadProjectConfig` path into the server's read path and the App's startup read of every Project. See [data compatibility](2026-10-15-backward-compatibility.md).

## Compatibility

- SDK code that imported the catalog from `@prismshadow/penguin-core` or `@prismshadow/penguin-core/model-catalog` imports it from `@prismshadow/penguin-server/model-catalog`. Connection helpers (`effectiveConnection`, `groupKeyReaches`, `resolveEntryCredential`, `canonicalClientType`) stay in core.
- A data root only the SDK touches starts with no models and no default model. Add models with `addModel` and set a default before creating a Session; a model with no key and no base URL on itself or its group uses the vendor's environment variable. Projects created by the server, the desktop app or the CLI's server are seeded as before.
- `penguin config model …` on a Project whose config file does not exist starts from an empty table instead of the catalog presets.
