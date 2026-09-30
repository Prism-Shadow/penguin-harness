# Telemetry probes: each turn, each session, plugin loading and hot updates

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `server`, `cli`
- **PR:** [Myriad-Dreamin/penguin-harness#119](https://github.com/Myriad-Dreamin/penguin-harness/pull/119)

[中文版](2026-09-30-telemetry-probes.zh.md)

The telemetry switch from the first slice now also covers the server's side of a turn, the session list, plugin loading and hot updates, and the read route gains a machine view (PRFC-0008). As before, samples carry shapes only, and while the switch is off each probe is one boolean check.

- A turn: `task.accept` (accepting a Task, lock wait included), `session.ensure` (loading, reloading or reusing the runtime Session, with the resumed history's length), and per run one `turn.run` with the model's share (`modelMs`, from each `request_begin` to its `request_end`) plus `turn.tail`, `turn.fanout`, `turn.errors` and `turn.usage`, the per-message work summed over the run. `turn.badge` times each state broadcast. A run's samples carry the session, a task id and the request that started it.
- The session list: `sessions.list.sql`, `sessions.list.reconcile` and `sessions.list.rows`; `trace.reconcile` is recorded as `led` by the call that ran a reconcile and `shared` by a call that joined one already running.
- Plugin loading (the platform's load, per plugin and step): `plugin.load` with `activate`, `import`, `table`, `check`, `host`, or `reused`.
- Hot updates, platform side: `hmr.park` and `hmr.dispose` of the outgoing App (recorded by its successor), `hmr.admit` for the admission probe, and `hmr.generation` for every App create, with its cause (`boot`, `push`, `reassemble`) and how many times this process has created the same platform bundle. `process.memory` follows each create.

`GET /api/telemetry?view=machine` returns this process's memory, its App generations and what each loaded Session holds (resumed history, channel buffer, subscribers, live tail, queued follow-ups); `penguin telemetry --by machine` prints it.
