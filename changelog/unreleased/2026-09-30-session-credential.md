# An agent's commands carry its session's own credential, and no admin token is left on disk

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `server`, `cli`, `docs`, `scripts`
- **PR:** [Myriad-Dreamin/penguin-harness#121](https://github.com/Myriad-Dreamin/penguin-harness/pull/121)
- **Breaking:** yes — `<root>/api-token` is gone; a command line outside a session signs in instead

[中文版](2026-09-30-session-credential.zh.md)

A server-driven session's tool subprocesses no longer get the admin's authority as `PENGUIN_API_TOKEN`. They get a credential of the session's own, signed with a key the server holds in memory, which dies at the next restart.

- The credential reaches what an agent's own commands call, and nothing else (`403 session_scope`):
  - the agent's own sessions and the ones it creates with `penguin run` — a session list keeps only these;
  - the Project's organizations, or only its own for a desk or ticket session, with the `sessionId` / `agentId` a request claims held to the credential's own, and a write that claims nothing refused — every `penguin org` write carries its caller, including `handbook write` / `rm`, `calendar add` / `update` / `rm`, `hire`, `employee set`, `leave` and `desk renew`; `ticket attach` sends the caller's session as `callerSessionId`, since its `sessionId` is the session being attached, so an agent may attach a colleague's session;
  - the Project's agent list and agent creation, its own schedules, the Project's usage;
  - telemetry, read with `session=` naming one of its own sessions.
- Admin routes, hot updates (`/api/hmr`), machine proxies (`/server/…`), other Projects and every other route are refused.
- The server no longer writes `<root>/api-token`, and removes one an older build left. The boot token only signs session credentials; it is no credential itself.
- A person's sign-in token (`penguin auth login`, `penguin auth token`) is now accepted as `Authorization: Bearer`. Outside a session the CLI sends the sign-in stored on the data root; inside one it sends only the environment's credential and reads nothing off the disk.
- `scripts/deploy.mjs` documents `PENGUIN_API_TOKEN=$(penguin auth token)`.
- Docs: CLI Reference (server connection), Server API (Bearer credentials, session credential), Security, and the `penguin-orchestration` skill.

## Compatibility

- A command line that relied on the `api-token` file — the CLI outside a session, a script doing `$(cat <root>/api-token)` — gets `401` after the upgrade. Sign in once with `penguin auth login`, or `penguin auth token` on the machine that owns the data root (no password), or set `PENGUIN_API_TOKEN=$(penguin auth token)`.
- A hot push takes the new rules at once: the file an older runtime wrote at its boot stops authenticating. The file itself is removed at the next restart.
- An agent whose task reads other agents' sessions (`penguin ls` / `penguin logs` across the Project) now sees only its own agent's sessions.
