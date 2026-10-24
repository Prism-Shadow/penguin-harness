# Report missing contributed-page renderers

- **Date:** 2026-10-19
- **Type:** fix
- **Scope:** `web`

[中文版](2026-10-19-web-missing-page-renderer.zh.md)

Contributed pages threw an explicit error when their builtin component was missing instead of silently redirecting to chat. The diagnostic named the renderer, page key and path. Registered builtin components and iframe pages kept their rendering behavior.
