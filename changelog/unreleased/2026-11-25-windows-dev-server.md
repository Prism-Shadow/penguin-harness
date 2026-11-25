# Run the Windows dev server under Node's watcher and build its full workspace closure

- **Date:** 2026-11-25
- **Type:** fix
- **Scope:** `tooling`, `server`
- **Issue:** [#1834](https://github.com/Prism-Shadow/penguin-harness/issues/1834)

[中文版](2026-11-25-windows-dev-server.zh.md)

Updated `scripts/dev-server.mjs` on Windows to launch the server entry under Node's built-in `--watch` with `tsx`'s ESM loader (`--import`), and expanded `scripts/dev-prebuild.mjs` to build the full `@prismshadow/penguin-server...` and `@prismshadow/penguin-cli...` workspace dependency graph before starting the dev servers.

## Details

- Switched `scripts/dev-server.mjs` on `win32` from `tsx/cli watch` to `node --watch --import <tsx> ...`, so `pnpm dev` and `pnpm dev:server` bind port `7368` on Windows instead of stalling in `tsx watch` before startup.
- Kept `tsx/cli watch` with `--exclude` data-root globs on POSIX platforms.
- Replaced the hand-listed package filter in `scripts/dev-prebuild.mjs` with `--filter @prismshadow/penguin-server... --filter @prismshadow/penguin-cli... --filter !@prismshadow/penguin-ui`, so workspace packages imported by the server, CLI, and Web App (including `@prismshadow/amsp` and `@prismshadow/penguin-library-*`) are built in dependency order on a fresh checkout.
