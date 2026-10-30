# A gateway 4xx that masquerades an upstream failure no longer ends the run

- **Date:** 2026-10-16
- **Type:** fix
- **Scope:** `core`
- **PR:** [#1176](https://github.com/Prism-Shadow/penguin-harness/pull/1176)

[中文版](2026-10-16-gateway-4xx-server-side.zh.md)

A gateway in front of a provider answers upstream breakage with whatever 4xx it likes
(Console Go reports a broken upstream hop as 400/403/413). Taking that status at face
value turns a one-second hiccup into a dead run. `isFatalProviderRejection` now keeps
the retries alive when the provider's own payload declares a server-side failure or
carried no body, while truly fatal rejections still stop the run.
