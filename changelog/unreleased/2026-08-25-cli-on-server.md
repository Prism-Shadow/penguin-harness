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

## Agent-side ergonomics

- **Caller-context defaults**: inside a harness agent (`PENGUIN_SESSION_ID` present), a
  session created by `run` / `chat` defaults each unspecified field to the calling
  session's live values (`GET /api/sessions/$PENGUIN_SESSION_ID`) — Workspace, the model
  pair, approval mode and thinking level — the same inheritance `run_subagent` applies to
  spawned children. Per field: explicit flag > caller value > plain fallback; a failed
  lookup warns (dim) and falls back; outside an agent nothing changes.
- **`--timeout <duration>` soft yield** on `run` (non-background), `input` and `logs -f`:
  wait up to the budget (`30s` / `5m` / `2h`, or bare seconds), then detach cleanly —
  exit 0, a dim still-running line with the session id (`status: "running"` under
  `--json`) — while the task keeps running server-side, mirroring the command tools'
  yield-window semantics. No flag = wait indefinitely.
- **Bare `penguin input <session>` (no `-m`) polls**: prints the session's most recent
  complete assistant text (an idempotent last-answer snapshot; thinking and tool output
  skipped), mirroring `input_subagent`'s empty-prompt semantics — nothing queued, nothing
  steered. A running session is waited on silently (bounded by `--timeout` when given);
  still running at expiry prints the current latest text plus the still-running note.
- **`--timeout 0` replaces `input --no-wait`** (the surface was unreleased): the one
  timeout knob covers "don't wait" — deliver, then return immediately with the
  still-running note (`{sessionId, status: "running"}` under `--json`); `run --timeout 0`
  behaves the same for symmetry, while `run --background` stays the idiomatic
  fire-and-forget for new tasks (bare session id for scripts).
- **`penguin ls --days <n>`**: only sessions last active within the trailing n calendar
  days (today counts as day 1 — `cost --days` semantics); combines with `-a` and
  `--json`.
- **`penguin schedule add|update|rm <name>`**: a validated writer over the schedules
  API — the API writes the TOML file, which remains the single source of truth (the
  model-config/vault pattern), and API errors surface verbatim for synchronous
  validation. Target is `--session-id` XOR the new-session form; `--start-at now` means
  the current instant. One deliberate divergence: `add` defaults to enabled (`--disabled`
  opts out; the raw file's enabled=false default stays for hand edits); `update` is
  read-modify-write; `rm` deletes without prompting.

## The CLI-session toggle is retired

Sessions created through the API now carry a `client` hint (`"cli"` from the CLI, default
`"web"`), stored on the existing column as provenance only — list endpoints stopped
filtering by client, and the `cli=1` query parameter, the `showCliSessions` preference and
its settings toggle were removed. Legacy CLI-direct traces are adopted once per server
boot by a startup sweep; see
[backward compatibility](2026-08-25-backward-compatibility.md).
