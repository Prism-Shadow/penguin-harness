# Connecting a machine waits for its server to finish starting, and a refusal says the server's reason

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `server`, `docs`
- **PR:** [#1891](https://github.com/Prism-Shadow/penguin-harness/pull/1891)

[中文版](2026-11-26-machine-version-503.zh.md)

Connecting a remote machine on the Machines page no longer stops at the Sync config step with `Config not synced — could not ask that machine what it runs: it answered 503 when asked its version` when the machine's server is still starting. A machine's server binds its port before its App is built, and answers every request with a 503 that asks for a retry until then. Its status already read as running in that window, so a connect, an install or a restart asked it what it runs too early. The questions the Machines jobs ask a machine's server — its version, its handshake and the config sync — now wait out that answer for up to a minute, and a restart is done when the App answers, not when the port does. A job that this server cut stops waiting at once.

When a machine's server answers anything but a 200, the job says the reason it gave after the status: for example `it answered 503 when asked its version: penguin-server has no running platform: <why>` for a machine whose platform could not boot. The reason is the API error message, or else the first line of the answer, at most 200 characters. The handshake and the model sync's questions say it the same way.
