# The server's HTTP vocabulary and the model domain's flows become library packages

- **Date:** 2026-11-19
- **Type:** refactor
- **Scope:** `server`, `library/http`, `library/model`, `web`
- **PR:** [#1621](https://github.com/Prism-Shadow/penguin-harness/pull/1621)

[中文版](2026-11-19-library-http-and-model-flows.zh.md)

The pieces every route shares get a home of their own, and the model domain's key-authorization flows move beside the catalog that serves them. A new package, `@prismshadow/penguin-library-http`, holds the HTTP vocabulary: the unified error shape, the request-validation helpers, the JSON answer rules, the public origin and page CSP, the convergent delete wait, the error→Project attribution, and the `AppEnv` type the auth middleware fills. `@prismshadow/penguin-library-model` takes in the built-in model catalog (the browser-safe vocabulary the Web App already imports through the server's `model-catalog` subpath), the three key-authorization flow services with their capability interfaces, the flow wire shapes, and the two platform-origin validators.

The server imports these; nothing in the library imports the server, and the library packages' manifests stay cycle-free. Thin re-exports keep the old import paths stable — files, subpaths and DTOs; `services/platform-auth-types.ts` is the one deliberate exception, deleted outright because its catalog types now come from the library's single source. The Platform and ModelScope providers stay in the server: they read the `Config` capability, which is the server's assembly. The four model routes and the `config-model` CLI command also stay, riding runtime mechanisms that have not moved; they follow in later slices.

## Details

- `library/http` (new): `errors` (with the moved `ErrorBody`/`ErrorDetails`), `app-env`, `validate` (the general helpers; the Session-domain checks stay in the server beside their types), `media-type`, `json-answer`, `json-compression`, `json-validators`, `public-origin`, `page-csp`, `settle`, `attribution`.
- `library/model` grows: `model-catalog/` (catalog, client-protocols, env-keys, seed), `model-oauth-service`, `modelscope-auth-service`, `platform-auth-service` (services and capabilities; the Module providers stay in the server), `platform-auth-flow` (the flow wire shapes, `services/platform-auth-types.ts`'s single-sourced successor), `origins`.
- The client-protocol table gains the MMSP 0.5.10 client rows (`openai-image`, `openai-speech`, `openai-transcription`, `deepseek-webtool`, `deepseek-speech`, `deepseek-transcription`, `jina-webtool`), and the library's `mmsp` dependency aligns on `^0.5.10`.
- `services/platform-auth-types.ts` is deleted; the platform catalog types are single-sourced in the library. `config.ts` and `api/types.ts` re-export the moved validators and flow shapes.
