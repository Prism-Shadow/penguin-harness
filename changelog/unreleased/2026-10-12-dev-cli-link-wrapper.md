# The linked `penguin` runs on the dev CLI's data root

- **Date:** 2026-10-12
- **Type:** fix
- **Scope:** `cli`, `tooling`
- **PR:** [#1065](https://github.com/Prism-Shadow/penguin-harness/pull/1065)

[中文版](2026-10-12-dev-cli-link-wrapper.zh.md)

The `penguin` and `penguin-hmr` that `pnpm build` links onto PATH ran the built CLI without the environment `pnpm penguin` sets, so they used the installed release's data root `~/.penguin/data` and port 7364, and rewrote the release's Project configs into names it cannot read. `pnpm link:cli` now links a small wrapper package (`scripts/dev-cli-link`) with `pnpm add --global` — pnpm 11 had dropped `pnpm link --global`. Its bins run the built CLI in-process with `PENGUIN_HOME` defaulting to `~/.penguin/dev-data-cli`, `PENGUIN_PROFILE` to `dev` and `PORT` to `7369` (each only when unset or empty), and without an inherited `PENGUIN_CLI_ENTRY`. The same run removes the links an earlier `link:cli` left of this checkout's `packages/cli`.

## For contributors

- Run `pnpm link:cli` (or `pnpm build`) once. If pnpm says its global bin directory is not on PATH, run `pnpm setup` once and open a new shell.
- To use the installed data root on purpose, name it per command: `PENGUIN_HOME=~/.penguin/data penguin <args>`.
