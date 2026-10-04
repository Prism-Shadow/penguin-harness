# An agent's commands carry its session's own credential

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `server`, `cli`, `docs`, `scripts`
- **PR:** [Myriad-Dreamin/penguin-harness#121](https://github.com/Myriad-Dreamin/penguin-harness/pull/121)
- **Breaking:** yes — an agent's commands reach only its own sessions and the routes they call

[中文版](2026-09-30-session-credential.zh.md)

A server-driven session's tool subprocesses no longer get the admin's authority as `PENGUIN_API_TOKEN`. They get a credential of the session's own, signed with a key derived from the boot token, which dies at the next restart.

- The credential reaches what an agent's own commands call, and nothing else (`403 session_scope`):
  - the agent's own sessions and the ones it creates with `penguin run` — a session list keeps only these;
  - the Project's organizations, or only its own for a desk or ticket session, with the `sessionId` / `agentId` a request claims held to the credential's own, and a write that claims nothing refused — every `penguin org` write carries its caller, including `handbook write` / `rm`, `calendar add` / `update` / `rm`, `hire`, `employee set`, `leave` and `desk renew`; `ticket attach` sends the caller's session as `callerSessionId`, since its `sessionId` is the session being attached, so an agent may attach a colleague's session;
  - the Project's agent list and agent creation, its own schedules, the Project's usage;
  - telemetry, read with `session=` naming one of its own sessions.
- Admin routes, hot updates (`/api/hmr`), machine proxies (`/server/…`), other Projects and every other route are refused.
- The server still writes the boot token to `<root>/api-token` (0600), and it is still an admin Bearer. Every App now writes the file when it starts, so a hot push restores a file that is missing (an earlier build of this change removed it). The boot token is never handed to a session.
- A person's sign-in token (`penguin auth login`, `penguin auth token`) is now accepted as `Authorization: Bearer`. The CLI's order: `PENGUIN_API_TOKEN`; outside a session, for a server on this machine, the sign-in stored on the data root, else the `api-token` file; inside a session only the environment's credential, and nothing off the disk.
- `scripts/deploy.mjs` documents `PENGUIN_API_TOKEN=$(penguin auth token)` beside `$(cat <root>/api-token)`.
- Docs: CLI Reference (server connection), Server API (Bearer credentials, session credential), Security, and the `penguin-orchestration` skill.

## Compatibility

- A command line that relies on the `api-token` file — the CLI outside a session, a script doing `$(cat <root>/api-token)` — keeps working with no action. `penguin auth login` is an alternative.
- The file is still an admin credential: whoever can read the data root is the admin. This change only takes it out of tool subprocesses. The session-credential signing key derives from the boot token, which a hot push keeps; only a restart replaces it.
- Later: the file is to be removed by a separate change once the automation that reads it (agent sessions, roadmap scripts, deploy scripts) has moved to sign-ins or session credentials, `penguin auth token` is available on every machine, and the server has logged no caller presenting the file outside a session for two weeks.
- An agent whose task reads other agents' sessions (`penguin ls` / `penguin logs` across the Project) now sees only its own agent's sessions.
