# Start the dev backend under `pnpm dev` on Windows and prebuild its full workspace closure

- **Date:** 2026-11-25
- **Type:** fix
- **Scope:** `tooling`, `server`
- **PR:** [#1855](https://github.com/Prism-Shadow/penguin-harness/pull/1855), [#1854](https://github.com/Prism-Shadow/penguin-harness/pull/1854)
- **Issue:** [#1834](https://github.com/Prism-Shadow/penguin-harness/issues/1834)

[中文版](2026-11-25-windows-dev-server.zh.md)

Made `pnpm dev` start the backend on port `7368` on Windows, and expanded `scripts/dev-prebuild.mjs` to build the full `@prismshadow/penguin-server...` and `@prismshadow/penguin-cli...` workspace dependency graph before starting the dev servers.

## Details

- `scripts/dev-server.mjs` passed stdin through to `tsx watch` only from a terminal, and gave it an empty stdin (`ignore`) otherwise, including the pipe concurrently attaches to each command under `pnpm dev`. Run from a terminal, `pnpm dev:server` kept tsx's Return-key rerun.
- Replaced the hand-listed package filter in `scripts/dev-prebuild.mjs` with `--filter @prismshadow/penguin-server... --filter @prismshadow/penguin-cli... --filter !@prismshadow/penguin-ui`, so a fresh checkout built the workspace packages the server, CLI, and Web App import (including `@prismshadow/amsp` and `@prismshadow/penguin-library-*`) in dependency order.
