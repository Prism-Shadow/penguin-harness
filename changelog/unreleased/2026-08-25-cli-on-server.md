# The CLI becomes a thin client of the server, and agents get a local control plane

- **Date:** 2026-08-25
- **Type:** feature
- **Scope:** `cli`, `server`, `core`, `web`, `docs`
- **PR:** [#466](https://github.com/Prism-Shadow/penguin-harness/pull/466)

[中文版](2026-08-25-cli-on-server.zh.md)

`penguin run` and `penguin chat` were rebuilt on the server API — the CLI now parses
arguments, sends HTTP/SSE requests, and renders the streamed OmniMessages, while the task
itself executes on the server. Everything the CLI creates shows up in the Web App and vice
versa, and a new command family lets agents inside PenguinHarness drive the harness through
the CLI: list sessions, send messages into them, follow logs, create agents, and query
costs and schedules. A CLI talking to the local machine's server needs no login.

## The command surface

```
penguin run -m <msg> [--project-id] [--agent-id] [--workspace] [--model-id --provider]
            [--approve] [--thinking] [--session <id>] [--background] [--goal [budget]]
            [--json] [--server <url>]
penguin chat [--project-id] [--agent-id] [--workspace] [--model-id --provider] [--approve]
             [--thinking] [--resume [id]] [--verbose] [--server]
penguin ls [--project-id] [--agent-id] [-a|--all] [--json] [--server]
penguin input <session_id> -m <text> [--no-wait] [--json] [--server]
penguin logs <session_id> [--tail <n>] [-f|--follow] [--json] [--server]
penguin agent ls|create ...
penguin project ls
penguin cost [--days <n>] [--from --to] [--by date|agent|model|session] ...
penguin schedule ls ...
```

- `run` creates a session (or reuses `--session` — a full id or any unique fragment, such
  as the 8-hex tail `penguin ls` prints), posts the task, renders the stream to the stats
  line, and exits 0 on completed (goal runs exit 0 only on `complete`). `--background`
  returns the session id immediately; `--json` prints a final `{sessionId, status, text}`.
- `input` steers a running session and starts a task on an idle one; `logs -f` follows the
  live stream read-only.
- `--project-id` / `--agent-id` default to `PENGUIN_PROJECT_ID` / `PENGUIN_AGENT_ID`, then
  `default_project` / `default_agent`.

## Connection and authentication

- Resolution order: `--server` > `PENGUIN_API_URL` > a live `server.lock` at the data root
  > auto-start (a detached `node <cli> server` with `PORT=0`, logging to
  `<root>/logs/server-auto-<date>.log`; the loser of a concurrent spawn race exits and
  both CLIs attach to the winner's lock).
- The server mints a local API token every boot and writes it to `<root>/api-token`
  (0600). `authMiddleware` accepts it as `Authorization: Bearer` (constant-time compare)
  and authenticates the caller as the built-in admin — on SSE endpoints too. The CLI reads
  `PENGUIN_API_TOKEN`, else the file (loopback targets only; a 401 re-reads it once); a
  remote `--server` without `PENGUIN_API_TOKEN` is refused with instructions.
- The authorization model is deliberate: local filesystem access to the data root already
  is admin authority — the `penguin server reset-admin-password` rule. An earlier on-disk
  token was removed over exactly this property; that objection is reversed on purpose,
  because agents driving their own server through the CLI is the feature.

## Control env injection

Server-driven sessions inject into every tool subprocess: `PENGUIN_API_URL` (the server's
own canonical base URL), `PENGUIN_API_TOKEN` (the current boot token),
`PENGUIN_PROJECT_ID`, `PENGUIN_AGENT_ID`, `PENGUIN_SESSION_ID`. The seam is
`CreateAgentOptions.controlEnv`, a policy getter mirroring `proxyEnv`: core binds it to
each Session's own coordinates and re-evaluates it at every spawn; injected entries
override vault entries of the same name; subagent sessions evaluate it with their own ids;
SDK/CLI-direct embedding without the option injects nothing.

## The CLI-session toggle is retired

Sessions created through the API now carry a `client` hint (`"cli"` from the CLI, default
`"web"`), stored on the existing column as provenance only — list endpoints stopped
filtering by client, and the `cli=1` query parameter, the `showCliSessions` preference and
its settings toggle were removed. Legacy CLI-direct traces are adopted once per server
boot by a startup sweep; see
[backward compatibility](2026-08-25-backward-compatibility.md).
