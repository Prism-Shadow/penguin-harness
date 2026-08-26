---
name: penguin-orchestration
description: Drive PenguinHarness itself from a shell — list and create agents and sessions, send and steer messages mid-flight, and query costs and scheduled tasks via the penguin CLI over the local server.
short_description: Orchestrate agents, sessions, costs and schedules with the penguin CLI.
short_description_zh: 用 penguin CLI 编排智能体、会话、成本与定时任务。
version: 1
updated: 2026-08-25T00:00:00Z
---

# Penguin Orchestration

The `penguin` CLI is a thin client of the PenguinHarness server. Inside a harness agent session it reaches the same server that is running you, so you can orchestrate the platform yourself: list and create agents, start conversations with them, steer those conversations while they run, and query costs and scheduled tasks.

## Before you start

If the user's message only invokes this skill (e.g. "use penguin-orchestration skill") without a concrete request, ask the user what they want to orchestrate. Read-only commands (`project ls`, `agent ls`, `ls`, `logs`, `cost`, `schedule ls`) are always safe; do not create agents, start sessions or send messages until the goal is clear.

## How the connection works

- **Inside a harness agent session** (you, now): every command subprocess has `PENGUIN_API_URL`, `PENGUIN_API_TOKEN`, `PENGUIN_PROJECT_ID`, `PENGUIN_AGENT_ID` and `PENGUIN_SESSION_ID` injected, so `penguin` commands automatically reach your own server with your project and agent as the defaults — no login step.
- **Outside an agent** (a human shell): the CLI attaches to the running local server via its lock file, or auto-starts one; the local `<data-root>/api-token` file (0600) authenticates it.
- You are operating the same server that runs you: sessions and agents you create appear live in the web UI, where the user sees and owns everything you spawn.
- The injected token is admin-equivalent. Act accordingly: stick to what the task requires, and prefer read-only commands until a mutation is clearly needed.

## Orient first

Before mutating anything, see what exists:

```bash
penguin project ls        # projects on this server
penguin agent ls          # agents in the current project
penguin ls --json         # the project's sessions, with running state
```

`--json` on any listing gives machine-parseable output.

## Command surface

```
penguin run -m <msg> [--project-id <id>] [--agent-id <id>] [--workspace <path>]
            [--model-id <id> --provider <p>] [--approve <mode>] [--thinking <level>]
            [--session <session_id>] [--background] [--timeout <duration>]
            [--goal [budget]] [--json]
penguin ls [--project-id <id>] [--agent-id <id>] [--days <n>] [-a|--all] [--json]
penguin input <session_id> [-m <text>] [--timeout <duration>]
              [--project-id <id>] [--json] [--server <url>]
penguin logs <session_id> [--project-id <id>] [--tail <n>] [-f|--follow]
             [--timeout <duration>] [--json]
penguin agent ls [--project-id <id>] [--json]
penguin agent create --agent-id <id> [--name <s>] [--description <s>] [--skills <a,b>]
                     [--project-id <id>] [--json]
penguin project ls [--json]
penguin cost [--days <n>] [--from <d> --to <d>] [--by date|agent|model|session]
             [--project-id <id>] [--agent-id <id>] [--json]
penguin schedule ls [--project-id <id>] [--agent-id <id>] [--json]
penguin schedule add <name> --prompt <s> --start-at <ISO|now> [--period <duration>]
                    [--end-at <ISO>] [--session-id <id> | --workspace <path>
                    [--model-id <id> --provider <p>]] [--disabled]
                    [--project-id <id>] [--agent-id <id>]
penguin schedule update <name> [<same field flags>] [--enable|--disable]
                    [--project-id <id>] [--agent-id <id>]
penguin schedule rm <name> [--project-id <id>] [--agent-id <id>]
```

- `run` starts a task and waits, rendering the conversation, unless `--background` — then it prints the new session id and exits while the server keeps running the task. `--session <session_id>` runs the task in an existing session instead of creating one; the model reference is the `--provider` + `--model-id` pair (both or neither); `--goal [budget]` runs in goal mode — the session loops until the agent declares the goal complete, with an optional spend budget.
- **Caller-context defaults.** Inside a harness agent, a session-creating `run` fills every field you leave unspecified from your own live session, per field independently: `--workspace`, the `--model-id`/`--provider` pair, `--approve` and `--thinking` inherit the caller's values — the same convention as `run_subagent` parent inheritance. Precedence: explicit flag > caller value > plain fallback (cwd, the Project default model, `allow-all`, none — used wholesale if the caller lookup fails, with a dim stderr note). So inside an agent, `penguin run -m "..."` alone typically does the right thing; pass flags only to diverge.
- `--timeout <duration>` (`30s`, `5m`, `2h`, or bare seconds) bounds the wait of a foreground `run`, an `input`, or a `logs -f`. Expiry is a soft yield, not an error: the command exits 0 while the task keeps running server-side, printing a still-running note that names the follow-up commands (`--json` prints `{sessionId, status: "running", text}` with the text so far). `--timeout 0` (also `0s`) returns immediately after delivery — the same note without collected text (`--json`: `{sessionId, status: "running"}`); on a bare poll it snapshots a running session instantly. `run --background` stays the idiomatic fire-and-forget for new tasks and rejects `--timeout`; `logs --timeout` requires `-f`.
- `input` with `-m` steers a **running** session mid-turn (the agent absorbs it as a course correction within the current task) or starts a new turn on an idle one; it waits for the reply unless a `--timeout` bounds the wait (`--timeout 0` = deliver and return at once). Bare `input <session_id>` (no `-m`) **polls**: it prints the session's most recent complete assistant text — an idempotent snapshot that skips user/thinking/tool output and never touches approvals, mirroring `input_subagent`'s empty-prompt semantics. A running session is waited on first (bounded by `--timeout`, else indefinitely); a session with no reply yet prints `(no assistant reply yet)`. `--json` reports `{sessionId, status, text}` — `idle`/`running` when polling, `completed`/`aborted`/`running` with `-m`.
- `ls` spans every agent of the project, newest first (by last active); archived sessions are left out unless `-a`/`--all` includes them, and `--days <n>` keeps only sessions last active since local midnight n−1 days ago — today counts as day 1, so `--days 2` is yesterday and today, `--days 7` this week. `logs` renders a session's transcript: `--tail <n>` for the last entries, `-f` to follow live.
- Session ids embed their creation timestamp — `session-YYYY-MM-DD-HH-mm-ss-<8hex>`. Every `<session_id>` argument takes any unique substring of an id; the 8-hex tail is the recommended short form, and an ambiguous fragment errors listing the candidates. On `input` and `logs`, `--project-id` scopes that fragment search (unnecessary with a full id).

## Recipes

### Yesterday's or this week's sessions, with their latest replies

```bash
penguin ls --days 2 --json    # yesterday + today (today counts as day 1)
penguin ls --days 7 --json    # this week; add -a to include archived sessions
penguin input <session_id>    # one session's latest complete assistant reply
```

- `--days <n>` keeps sessions last active since local midnight n−1 days ago. For strictly-yesterday, take `--days 2` and drop today's entries client-side — ids embed the creation date and the JSON carries last-active.
- Bare `input` prints the latest reply; add `--timeout 0` to snapshot a running session instantly instead of waiting for its turn to finish.

### Summarize this week's history in a new session

A fresh session gets a fresh context window for the summary; feed it through a file, not the prompt:

```bash
penguin ls --days 7 --json               # pick the sessions
penguin logs <session_id> --tail 100     # gather each transcript (widen if cut short)
# write what you gathered into a workspace file with your file tools, then:
penguin run -m "Read ./weekly-material.md and write the weekly summary to ./weekly-summary.md"
```

- **Exchange big material through workspace files.** Caller-context defaults mean the new session shares your workspace — write the gathered transcripts to `./weekly-material.md` and have the new session read it there. Pages of transcript do not belong in `-m`.
- Read the result from `./weekly-summary.md` (the foreground run also renders the reply).

### Create an agent and say hello

```bash
penguin agent create --agent-id greeter --name "Greeter" --description "Welcomes people"
penguin run --agent-id greeter -m "Hello! Introduce yourself."
```

- Agent ids must match `^[a-z][a-z0-9_]{1,63}$`: a lowercase letter first, then lowercase letters, digits and underscores — no hyphens.
- A newly created agent starts with **no skills preinstalled**: seed it at creation with `--skills a,b` (library names) — include `penguin-orchestration` itself when the new agent must drive the harness too.
- `--agent-id` switches only the agent: workspace, model, approval and thinking still inherit from your own session (caller-context defaults) — add those flags to change them too. Each `run` without `--session` opens a fresh session; reuse a session id to continue a conversation.

### Summarize each agent's costs in a new session

```bash
penguin cost --days 7 --by agent --json    # who spent what this week
penguin run -m "Summarize this per-agent cost report and flag anomalies: <the JSON>"
```

- The default `penguin cost` card already carries today / last 7 days / total; `--by date|model|session` and `--from <d> --to <d>` give the other cuts, `--project-id` / `--agent-id` narrow the scope.
- A `--by agent` report is small enough to inline in `-m`; for long breakdowns (`--by session` over a busy week), use the file-exchange pattern from the weekly-summary recipe.

### Set up a scheduled task for the current agent

```bash
penguin schedule add daily-report --prompt "Summarize yesterday's conversations" \
  --start-at now --period 1d
penguin schedule ls                                  # verify
penguin schedule update daily-report --period 12h    # adjust; --enable/--disable to toggle
penguin schedule rm daily-report                     # remove — no confirmation prompt
```

- `--agent-id` defaults to yourself from the caller env, so this schedules the current agent. `--start-at` takes ISO 8601 or `now`; `--period` is at least 5m (`30m`/`12h`/`1d`/`7d`), omit it for a one-shot; `--end-at` bounds recurrence. Target flags are optional: `--session-id <id>` fires into that existing session, `--workspace <path>` (optionally with the `--model-id` + `--provider` pair) pins the new-session form.
- `add` creates the schedule **enabled** (`--disabled` stages it off) — deliberately diverging from the raw file, where `enabled` defaults to false. `update` is read-modify-write: unspecified fields keep their stored values, and switching the target form clears the other one.
- In `schedule ls`, read: the AGENT column (without `--agent-id` the listing spans agents), `enabled` (a disabled entry never fires), `startAt` (first firing), `period` (absent means one-shot), the target — an existing session versus a new session per firing — and `lastFiredAt`.
- The CLI writes through the schedules API, so mistakes are rejected synchronously. The TOML file stays the single source of truth — `<app_data_dir>/agents/<agent_id>/agent_state/schedule/<name>.toml`, fields mirroring the flags (`prompt`, `enabled` — false by default in the file, `start_at`, `period`, `end_at`, `session_id` / `workspace`+`provider`+`model_id`) — and remains editable with file tools; your system prompt's schedule roster lists yours. A hand edit is only validated by the periodic reconcile (roughly every 30s), with errors landing in error records rather than your terminal — prefer the CLI.

### Run a conversation in the background and steer it mid-flight

Two patterns; both leave you free while the conversation runs.

**(a) Background CLI process — you get a completion report.** Run the CLI itself as a background command: `exec_command` with `run_in_background: true` and the command

```bash
penguin run --agent-id <agent_id> -m "<long task>"
```

- The harness delivers a `[background_task_done]` report when the CLI exits — no polling needed for completion.
- Meanwhile, find the session with `penguin ls --json` (it shows as running, with the newest id) and steer it: `penguin input <session_id> -m "Focus on X; skip Y" --timeout 0` (deliver and return at once).
- Poll the latest answer with bare `penguin input <session_id> --timeout 30s` — a bounded wait that exits 0 with a still-running note when the reply is not in yet — or read the raw transcript with `penguin logs <session_id> --tail 20`.

**(b) Server-side background — survives you.** `penguin run --background --agent-id <agent_id> -m "<long task>"` prints the session id and exits; the server keeps running the task with no local process.

- Poll the latest answer with bare `penguin input <session_id> --timeout 30s`, watch live with `penguin logs <session_id> -f`, and check running state with `penguin ls --json`; steer with `penguin input <session_id> -m ...` the same way.

Prefer (a) when you stay around for the result — the completion report comes to you. Prefer (b) when the work must survive your own session ending, or when fanning out many tasks without holding a process per task. A bounded foreground run is the middle ground: `penguin run --timeout 5m -m "..."` renders up to the bound, then soft-yields with the task still running — pick up the answer later with a bare `penguin input <session_id>`.

## Cautions

- **One active task per session.** `penguin input` at a busy session steers the running task rather than starting a second one; a new task sent at a busy session waits its turn. For parallel work, start parallel sessions.
- **Unattended sessions must not need a human.** A spawned session inherits your approval mode (`allow-all` when there is no caller to inherit from); if you yourself run under `always-ask`, pass `--approve allow-all` (trusted work) or `--approve read-only` explicitly — an unattended `always-ask` session hangs waiting for approval in the web UI.
- **No runaway loops.** An agent that messages itself — directly, through a chain of agents, or through a schedule aimed back at its own session — keeps spending until someone stops it. Make every automated conversation terminate.
- **Spawned work bills the project.** Everything you start lands in the same project's usage (`penguin cost` shows it); a fan-out of sessions multiplies spend.
- **Configuration stays CLI-managed.** Never read or hand-edit `.project_config.toml` or `agent_state/.vault.toml` — models and secrets go through `penguin config` (see the penguin-cli skill).
