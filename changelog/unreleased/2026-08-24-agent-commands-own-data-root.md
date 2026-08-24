# Agent-run commands no longer inherit the harness's data root

- **Date:** 2026-08-24
- **Type:** fix
- **Scope:** `core`
- **PR:** [#434](https://github.com/Prism-Shadow/penguin-harness/pull/434)
- **Breaking:** yes — `PENGUIN_HOME` and `PENGUIN_WEB_DB` no longer reach commands an Agent runs; set them in the Agent's vault to pass them on

[中文版](2026-08-24-agent-commands-own-data-root.zh.md)

`PENGUIN_HOME` and `PENGUIN_WEB_DB` join the variables stripped from the environment of every
command an Agent runs, alongside `PORT`, `HOST` and the rest of the harness's own plumbing. A
harness an Agent starts now takes its own default data root instead of the one the running harness
was serving from.

## Details

- The two were previously left inheriting, on the grounds that the self-development case may
  legitimately want the same data root. Inheriting them is not that decision being made, though:
  it is an accident of where the serving process happens to be pointed. Whenever an Agent spawns a
  command the harness is by definition up and holding `<root>/server.lock`, so an Agent-started
  server on the inherited root exits 3 against a lock whose owner is the process that handed it
  the root.
- Sharing a root is still available and is now stated rather than inherited: the Agent's vault is
  applied after the host environment, so a `PENGUIN_HOME` set there reaches commands unchanged.
  This is the escape hatch `FORCE_COLOR` already documents.
- Matching is case-insensitive, like every other stripped name, so a Windows `set Penguin_Home=…`
  is removed too.

## 兼容性

A command run by an Agent that relied on inheriting `PENGUIN_HOME` or `PENGUIN_WEB_DB` from the
serving process now sees neither, and any harness it starts resolves the default root
(`~/.penguin/data`, or `~/.penguin/dev-data` for an unpackaged dev build). Nothing on disk changes
and no migration runs. To restore the previous behaviour for one Agent, add `PENGUIN_HOME` — and
`PENGUIN_WEB_DB` if it was set — to that Agent's vault; the value reaches its commands exactly as
before.
