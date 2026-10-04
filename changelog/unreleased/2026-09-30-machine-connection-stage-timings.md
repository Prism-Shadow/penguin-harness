# A machine connect says which stage its time went to

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `server`
- **PR:** [#981](https://github.com/Prism-Shadow/penguin-harness/pull/981)

[中文版](2026-09-30-machine-connection-stage-timings.zh.md)

A connect job in `GET /api/projects/:projectId/machines` now carries `stages`: each connect stage it ran (`probe`, `start-server`, `reprobe`, `hold`, `sync-models`, `sync-plugins`), with `startedAt`, `endedAt` and `ok`. Stages a connect does not need are not listed. A successful connect's result adds `connectedAt`, the moment the connection was held. Both fields are optional in the API types, because a machine running an older server does not send them.

The machine layer's telemetry follows the telemetry switch. While it is on, these samples go into the server's telemetry buffer, keyed by the machine's address as `keys.machine`:

- each connect stage is a `machine.connect.stage` sample, and the whole connect is a `machine.connect` sample, re-holds included;
- each command on the session is a `machine.ssh.command` sample — from the ask to the answer, its exit code, a timeout as such — never its text.

While it is off, each point costs one check: no clock read, no allocation, no timer. The `Telemetry` mechanism gains `watch(listener)`, which reports the switch at once and on every change.
