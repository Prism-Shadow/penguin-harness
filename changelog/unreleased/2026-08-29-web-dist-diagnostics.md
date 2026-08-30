# The server names its web dist, and refuses a restored web version without index.html

- **Date:** 2026-08-29
- **Type:** fix
- **Scope:** `server`, `desktop`
- **PR:** [#544](https://github.com/Prism-Shadow/penguin-harness/pull/544)

[中文版](2026-08-29-web-dist-diagnostics.zh.md)

A server whose static tail had nothing to serve answered 404 on every page and said nothing about it. Three changes name the condition instead.

## Details

- Startup prints `Web dist: <path>` beside `Data root:` and `SQLite:`, and warns when that directory has no `index.html` — a wrong `PENGUIN_WEB_DIST` or a missing `packages/web` build now shows up in the log rather than as a bare 404.
- The packaged desktop app pins the embedded server to its own `web-dist` (`PENGUIN_WEB_DIST`, an explicit value still winning) and checks for its `index.html` before the fork; a build packed without the web assets now fails at startup with the path named, instead of opening a window on a 404. A source run pins nothing and keeps the server's fallback to `packages/web/dist`.
- Restoring a persisted hot-pushed version now requires the stored web dist to contain `index.html`, the same floor a push is held to. A store file without it fails the restore with the ordinary `persisted version failed to restore` warning naming the file, and the packaged web dist is served instead of an in-memory version that 404s everywhere.
