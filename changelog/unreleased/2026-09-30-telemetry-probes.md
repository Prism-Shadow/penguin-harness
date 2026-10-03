# Telemetry probes: accepting a Task, each session, plugin loading and hot updates

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `server`
- **PR:** [Myriad-Dreamin/penguin-harness#119](https://github.com/Myriad-Dreamin/penguin-harness/pull/119)

[中文版](2026-09-30-telemetry-probes.zh.md)

The telemetry switch from the first slice now also covers accepting a Task, loading a Session, the session list, plugin loading, hot updates, and the memory of the process and of each loaded Session (PRFC-0008). As before, samples carry shapes only — each attribute named for what it is (`messages`, `rows`, `memoryCost`) — and while the switch is off each probe is one boolean check.

- A Task: `task.accept` (accepting a Task, lock wait included, and whether it was queued) and `session.load` (loading a Session that was not in memory, with the resumed history's length), keyed by the session and the request. A turn's own timings — its length, the model's share, its messages — are in its Trace and are not sampled again.
- The session list: `sessions.list.sql` and `sessions.list.reconcile`; `trace.reconcile` once per pass, however many callers joined it.
- Plugin loading: `plugin.load` for each plugin the platform imports and checks.
- Hot updates, platform side: `hmr.park` and `hmr.dispose` of the outgoing App (recorded by its successor), `hmr.admit` for the admission probe, and `hmr.generation` for every App create (the boot and hot-update timings live in `telemetry/boot.ts`; the platform's boot makes one-line calls into it), with its cause (`boot`, `push`, `reassemble`).

- Memory: when the buffer is read, `process.memory` records the process's and `session.memory` each loaded Session's `memoryCost` — the bytes it holds: its resumed history (estimated once per load), the stream events kept for a page that reconnects, and the replies still streaming. `process.memory` is also recorded after each create.
