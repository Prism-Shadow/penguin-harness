# Boot the dev backend when `pnpm dev` hands it a pipe

- **Date:** 2026-11-25
- **Type:** fix
- **Scope:** `tooling`
- **PR:** [#1854](https://github.com/Prism-Shadow/penguin-harness/pull/1854)
- **Issue:** [#1834](https://github.com/Prism-Shadow/penguin-harness/issues/1834)

[中文版](2026-11-25-dev-server-stdin-deadlock.zh.md)

`scripts/dev-server.mjs` now passes stdin through to tsx only when it is a terminal and hands the child `ignore` otherwise. `pnpm dev` gives both halves a pipe through concurrently, and that shared pipe deadlocked the server on Windows: tsx watch listens on it for the Return key while the server inherits the same handle, so the boot stalled while loading `node:process` and never bound `127.0.0.1:7368` — every `/api` call reached the Vite proxy as `ECONNREFUSED`, and the App reported `not_the_server`.

## Details

- The import that walks into the stall in this checkout is core's MCP provider loading `@modelcontextprotocol/client`, with the last load logged being `node:process`. The mechanism is tsx's own report, tsx [#623](https://github.com/privatenumber/tsx/issues/623).
- A terminal stdin still passes through, so `pnpm dev:server` keeps tsx's Enter-to-rerun; under `pnpm dev` that key is off.
- The data root's `--exclude` arguments — the reason `tsx watch` is kept over a bare watcher — are unchanged.
