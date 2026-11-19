# The server's HTTP vocabulary and model domain now come from the library packages

- **Date:** 2026-11-19
- **Type:** process
- **Scope:** `server`, `web`
- **PR:** [#1621](https://github.com/Prism-Shadow/penguin-harness/pull/1621)

[中文版](2026-11-19-backward-compatibility-library-restack.md)

The server's HTTP vocabulary (the unified error shape, request validation, the JSON answer rules, the public origin and page CSP, and related helpers) moved to the new `@prismshadow/penguin-library-http` package, and the model catalog together with the model key-authorization flow services moved to `@prismshadow/penguin-library-model`. Nothing else in this batch changes behavior: the moved code is the same code at a new address.

The old import paths keep working for now. Every moved module is re-exported from its previous address under `@prismshadow/penguin-server` (`/http/errors`, `/http/validate`, `/model-catalog`, and the rest), so code that imports those paths runs unchanged.

### What you need to do

If you import these modules from the server package, import them from the library packages instead — `@prismshadow/penguin-library-http` and `@prismshadow/penguin-library-model`. The new paths are where the modules live now; the old ones are only forwards.

### Lifetime

These re-export entries will be deleted in penguin v0.3. After that, importing a moved module from `@prismshadow/penguin-server` fails; import it from its library package.
