# The server's HTTP vocabulary and model domain now come from the library packages

- **Date:** 2026-11-19
- **Type:** process
- **Scope:** `server`, `web`
- **PR:** [#1621](https://github.com/Prism-Shadow/penguin-harness/pull/1621)

[中文版](2026-11-19-backward-compatibility-library-restack.zh.md)

The server's HTTP vocabulary (the unified error shape, request validation, the JSON answer rules, the public origin and page CSP, and related helpers) moved to the new `@prismshadow/penguin-library-http` package, and the model catalog together with the model key-authorization flow services moved to `@prismshadow/penguin-library-model`. Nothing else in this batch changes behavior: the moved code is the same code at a new address.

Old import paths keep working, in two different ways:

- **Package subpaths** that existed before — `@prismshadow/penguin-server/model-catalog`, `@prismshadow/penguin-server/api` — still export the moved names, re-exported from the library. Code importing these package paths runs unchanged.
- **In-repo source paths** — the server source files the moved modules used to live in (`packages/server/src/http/errors.ts`, `packages/server/src/http/page-csp.ts`, and their siblings) — are now one-line re-export files. Code inside this repository that imports them relatively keeps resolving.

`services/platform-auth-types.ts` is the one deliberate exception: the file is deleted rather than re-exported, because the shapes it carried are single-sourced in the library's `platform-auth-flow`; the file is back as a pure re-export shim, so even this path resolves.

### What you need to do

If you import these modules, import them from the library packages instead — `@prismshadow/penguin-library-http` and `@prismshadow/penguin-library-model`. The new paths are where the modules live now; the old ones are only forwards.

### Lifetime

These re-export entries will be deleted in penguin v0.3. After that, importing a moved module from `@prismshadow/penguin-server` fails; import it from its library package.
