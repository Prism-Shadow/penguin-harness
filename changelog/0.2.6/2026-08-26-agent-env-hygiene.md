# The dev CLI serves from its own data root, so it coexists with `pnpm dev`

- **Date:** 2026-08-26
- **Type:** fix
- **Scope:** `tooling`, `core`, `cli`
- **PR:** [#471](https://github.com/Prism-Shadow/penguin-harness/pull/471)

[中文版](2026-08-26-agent-env-hygiene.zh.md)

`pnpm penguin` moved to its own default data root, `~/.penguin/dev-data-cli`, completing the
isolation its port (7369) began. A data root admits one server at a time (`<root>/server.lock`), so
on the shared `~/.penguin/dev-data` the dev CLI's `penguin web` and `pnpm dev:server` could only run
alternately — and a harness started as `pnpm penguin web` is exactly the one that asks an Agent to
run `pnpm dev` in this repo. With the split, that Agent's `dev:server` starts instead of exiting 3
against the harness's own lock.

## Details

- The allocation table in `packages/core/src/internal/ports.ts` grew a data-root column and now
  also names the desktop's port behavior (no fixed port; sticky `PORT=0` allocation) and the web
  e2e harness's ports and throwaway root, so one place answers both questions.
- A new `dev-entry-isolation` test in the CLI package pins the pairwise disjointness of the
  (port, data root) pairs — the assignments live on package.json script lines that nothing
  type-checks — and that the root and `packages/cli` spellings of the `penguin` script agree.
- The dev desktop shell stayed on `~/.penguin/dev-data` deliberately: a second server on a locked
  root is its attach-mode case rather than a startup failure, and `pnpm dev` and `pnpm desktop`
  used alternately sharing one dataset is the point of the common root. The test pins that choice
  too.
- Two regression tests pinned environment guarantees that previously had no local coverage: a
  stdio MCP server never sees the serving process's `PENGUIN_*` / `PORT` (its child environment is
  the MCP SDK's safe-inherited allowlist plus the entry's own `env` — the same outcome the
  [command-environment strip](2026-08-24-agent-commands-own-data-root.md) enforces, by the opposite
  mechanism), and an explicit injection layered after that strip wins for any `PENGUIN_*` name —
  the seam the Agent vault uses today and any later injection layer composes with.

## Compatibility

Contributors take a one-time move: `pnpm penguin` had run on `~/.penguin/dev-data`, so Agents and
Sessions created through it no longer appear in its window — the data itself stays on disk,
untouched. To aim a dev CLI command at the `pnpm dev` dataset, say so per command
(`PENGUIN_HOME=~/.penguin/dev-data pnpm penguin config model list`, or `--root` where the
subcommand takes it). Installed entry points and both desktop forms are unaffected.
