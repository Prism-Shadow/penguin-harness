# Telemetry probes: each turn, each session, plugin loading and hot updates

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `server`, `cli`
- **PR:** [Myriad-Dreamin/penguin-harness#119](https://github.com/Myriad-Dreamin/penguin-harness/pull/119)

[中文版](2026-09-30-telemetry-probes.zh.md)

The telemetry switch from the first slice now also covers the server's side of a turn, the session list, plugin loading, hot updates, and the 内存 of the process and of each loaded Session (PRFC-0008). As before, samples carry shapes only — each attribute named for what it is (`messages`, `rows`, `memoryCost`) — and while the switch is off each probe is one boolean check.

- A turn: `task.accept` (accepting a Task, lock wait included), `session.load` (loading a Session that was not in memory, with the resumed history's length), and per run one `turn.run` with the model's share (`modelMs`, from each `request_begin` to its `request_end`) plus `turn.tail`, `turn.fanout`, `turn.errors` and `turn.usage`, the per-message work summed over the run. `turn.badge` times each state broadcast. A run's samples carry the session, a task id and the request that started it.
- The session list: `sessions.list.sql` and `sessions.list.reconcile`; `trace.reconcile` once per pass, however many callers joined it.
- Plugin loading: `plugin.load` for each plugin the platform imports and checks.
- Hot updates, platform side: `hmr.park` and `hmr.dispose` of the outgoing App (recorded by its successor), `hmr.admit` for the admission probe, and `hmr.generation` for every App create (the boot and hot-update timings live in `telemetry/boot.ts`; the platform's boot makes one-line calls into it), with its cause (`boot`, `push`, `reassemble`).

- 内存: when the buffer is read, `process.memory` records the process's and `session.memory` each loaded Session's `memoryCost` — the bytes it holds: its resumed history, the stream events kept for a page that reconnects, and the replies still streaming. `process.memory` is also recorded after each create.
