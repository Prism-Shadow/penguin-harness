# Telemetry, first slice: a switch, an in-memory buffer, three probes, an admin read route and `penguin telemetry`

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `server`, `cli`, `core`
- **PR:** [#965](https://github.com/Prism-Shadow/penguin-harness/pull/965)

[中文版](2026-09-30-telemetry-first-slice.zh.md)

The server can now say where its time goes (PRFC-0008). A module measures through one call — `span` (or `time`, for synchronous work) on the Telemetry node — and holds no clock or scope of its own. A new system setting, `telemetry` (off by default; `PUT /api/admin/settings`), switches on three fixed probes that record shape-only samples — durations, sizes, counts, statuses, never content — into a bounded in-memory buffer (50,000 samples or 16 MB, oldest evicted). Nothing is written to disk or sent anywhere; a restart or a hot push starts the buffer empty. While the switch is off each probe is one boolean check and no buffer exists.

- `http.request`: every request the platform answers, on both the HTTP and the API-socket surface — method, route pattern (never the path or query), status, time to the response, the request's bytes and the response's when it declares them. Each request gets an id, and the samples it causes carry the same id.
- The boot of each App generation: migration, plugin loading, every module of the tree (`bootModules` takes an optional `onCreated` callback for this), the whole create, and `boot.quiet` once the trace-adoption and machine sweeps have settled. Each sample carries the generation number.
- A session open: `session.messages` for a windowed history read (window kind, messages) and `trace.read` for each Trace file it reads (records), under the same session.

`GET /api/telemetry?view=probes|sessions|samples` (admins only; others get 403) summarizes the buffer per probe (count, p50, p95, max, bytes) or per session, or lists the samples; `DELETE /api/telemetry` empties it. `penguin telemetry` prints the same views and has `on`, `off` and `clear`; run inside a session it shows that session's samples unless `--all` is given.
