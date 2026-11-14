# A conversation that never ran keeps its id when the server rebuilds it

- **Date:** 2026-10-19
- **Type:** fix
- **Scope:** `server`, `core`
- **PR:** [#1233](https://github.com/Prism-Shadow/penguin-harness/pull/1233)

[中文版](2026-10-19-session-keeps-id-on-rebuild.zh.md)

A conversation with a messaging bot enabled that had not run a turn stopped answering after a server restart. The restarted server rebuilt that Session on the first message under a new id, while the binding stayed on the old one: the bot kept receiving, the replies went nowhere, and the binding pointed at a Session that no longer existed. A Session that never ran is now rebuilt under its own id, so its binding, its terminals and the page that has it open stay attached to it.

## Details

- The server rebuilds a Session with no Trace (created, never run, and its runtime gone since, after a restart or an idle eviction) from its index row under the row's own id, instead of a new one.
- An enabled binding's Session is loaded when its connection comes up even when it has never run, as one that has already run was.
- SDK: `agent.createSession` takes an optional `sessionId`, for a host recreating a Session it recorded before the Session's first run. The id may contain only letters, digits, `-` and `_`, and a Session whose id already has a Trace is refused (it is resumed with `resumeSession` instead).
