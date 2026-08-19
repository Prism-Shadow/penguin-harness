# Dependencies: hono ≥ 4.12.34 (CORS preflight ReDoS)

- **Date:** 2026-08-04
- **Type:** fix
- **Scope:** `server`
- **PR:** [#197](https://github.com/Prism-Shadow/penguin-harness/pull/197)

[中文版](2026-08-04-deps-hono-redos.zh.md)

Resolves the repository's one open Dependabot alert: GHSA-8j4g-w8fx-2239 / CVE-2026-69207, a moderate ReDoS in Hono's `hono/cors` middleware — quadratic regex backtracking on an attacker-controlled `Access-Control-Request-Headers` preflight header when `allowHeaders` is unconfigured. The server package's direct `hono` range moves from `^4.8.0` to `^4.12.34` (the first patched version, same major); the lockfile change is confined to the hono chain, and `pnpm audit` reports no known vulnerabilities after the bump.
