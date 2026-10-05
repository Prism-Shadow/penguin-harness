# Reload an outdated page when a lazy chunk disappears

- **Date:** 2026-10-05
- **Type:** fix
- **Scope:** `web`

[中文版](2026-10-05-stale-build-reload.zh.md)

A tab opened before a web push reloads once, onto the current build, the first time one of its lazy chunks fails to load. Such a tab asked for chunk names the pushed dist no longer had, the server answered them with the app page, and so its terminals, never opened. A chunk that still fails after that reload is not reloaded for again: the terminal shows the error instead of staying on connecting.
