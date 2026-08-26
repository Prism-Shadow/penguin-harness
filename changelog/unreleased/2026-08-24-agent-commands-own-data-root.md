# Agent-run commands no longer inherit the harness's own environment

- **Date:** 2026-08-24
- **Type:** fix
- **Scope:** `core`
- **PR:** [#434](https://github.com/Prism-Shadow/penguin-harness/pull/434)
- **Breaking:** yes — no `PENGUIN_*` variable reaches commands an Agent runs; set the ones you want in the Agent's vault

[中文版](2026-08-24-agent-commands-own-data-root.zh.md)

Every `PENGUIN_*` variable is stripped from the environment of every command an Agent runs,
alongside `PORT`, `HOST` and the rest of the harness's own plumbing. A harness an Agent starts now
takes its own default data root instead of the one the running harness was serving from, and reads
none of that installation's other settings.

Matching is by prefix rather than by name. The harness read 25 such variables when this was
written and a by-name list had caught seven; a list has to be remembered at exactly the moment
nobody is thinking about it, so a variable a future feature adds is covered without an edit here.

## Details

- Outbound proxy settings are the deliberate exception and are unaffected: they are `HTTP_PROXY`
  and friends, governed by the host's proxy policy, not `PENGUIN_*`. `PENGUIN_TRUST_PROXY` only
  looks like one — it decides whether the server trusts an inbound `x-forwarded-proto`.
- `PENGUIN_HOME` and `PENGUIN_WEB_DB` were previously left inheriting, on the grounds that the self-development case may
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

## Compatibility

A command run by an Agent that relied on inheriting any `PENGUIN_*` variable from the serving
process now sees none of them, and any harness it starts resolves the default root
(`~/.penguin/data`, or `~/.penguin/dev-data` for an unpackaged dev build). Nothing on disk changes
and no migration runs. To restore the previous behaviour for one Agent, add the variables it needs to that
Agent's vault; those values reach its commands exactly as before.
