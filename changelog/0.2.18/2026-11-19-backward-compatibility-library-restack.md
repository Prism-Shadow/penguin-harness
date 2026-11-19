# The server's HTTP vocabulary and model domain now come from the library packages

- **Date:** 2026-11-19
- **Type:** process
- **Scope:** `server`, `web`
- **PR:** [#1621](https://github.com/Prism-Shadow/penguin-harness/pull/1621)

[中文版](2026-11-19-backward-compatibility-library-restack.zh.md)

The server's HTTP vocabulary (the unified error shape, request validation, the JSON answer rules, the public origin and page CSP, and related helpers) moved to the new `@prismshadow/penguin-library-http` package, and the model catalog together with the model key-authorization flow services moved to `@prismshadow/penguin-library-model`. Nothing else in this batch changes behavior: the moved code is the same code at a new address.

Old import paths keep working, in two different ways:

- **Package subpaths** that existed before — `@prismshadow/penguin-server/model-catalog`, `@prismshadow/penguin-server/api` — still export the moved names, re-exported from the library. Code importing these package paths runs unchanged.
- **In-repo source forwards** — the server source files a moved module's consumers still import (`packages/server/src/http/errors.ts`, `packages/server/src/http/validate.ts`, `packages/server/src/services/platform-auth-types.ts`, and the `services/*-service.ts` assemblies) — re-export or forward to the library. Code inside this repository that imports these paths keeps resolving.

Most of the moved modules' old source files are already gone: only the forwards above remain, and everything else now imports the library packages directly. `services/platform-auth-types.ts` is one of those forwards — its shapes are single-sourced in the library's `platform-auth-flow`, and the file only re-exports them.

### What you need to do

If you import these modules, import them from the library packages instead — `@prismshadow/penguin-library-http` and `@prismshadow/penguin-library-model`. The new paths are where the modules live now; the forwards exist only for the imports this repository has not moved over yet.

### Lifetime

The remaining forwards will be deleted in penguin v0.3, together with the in-repo imports that still go through them. After that, importing a moved module from `@prismshadow/penguin-server` or from the old server source paths fails; import it from its library package.
