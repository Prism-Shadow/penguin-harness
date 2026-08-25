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
            [--session <session_id>] [--background] [--goal [budget]] [--json]
penguin ls [--project-id <id>] [--agent-id <id>] [-a|--all] [--json]
penguin input <session_id> -m <text> [--no-wait] [--json]
penguin logs <session_id> [--tail <n>] [-f|--follow] [--json]
penguin agent ls [--project-id <id>] [--json]
penguin agent create --agent-id <id> [--name <s>] [--description <s>] [--skills <a,b>]
                     [--project-id <id>] [--json]
penguin project ls [--json]
penguin cost [--days <n>] [--from <d> --to <d>] [--by date|agent|model|session]
             [--project-id <id>] [--agent-id <id>] [--json]
penguin schedule ls [--project-id <id>] [--agent-id <id>] [--json]
```

- `run` starts a task and waits, rendering the conversation, unless `--background` — then it prints the new session id and exits while the server keeps running the task. `--session <session_id>` runs the task in an existing session instead of creating one. The model reference is the `--provider` + `--model-id` pair (both or neither; neither means the project default). `--thinking <level>` overrides the agent's thinking level for this run; `--workspace` sets the session's working directory (omit for a temporary workspace); `--goal [budget]` runs in goal mode — the session loops until the agent declares the goal complete, with an optional spend budget.
- `input` steers a **running** session mid-turn (the agent absorbs it as a course correction within the current task) or starts a new turn on an idle one. By default it waits for the reply; `--no-wait` returns right after delivery.
- `ls` lists sessions newest first; `-a`/`--all` lifts the default cap and lists the full history. `logs` renders a session's transcript: `--tail <n>` for the last entries, `-f` to follow live.
- Session ids embed their creation timestamp — `session-YYYY-MM-DD-HH-mm-ss-<8hex>` — and every `<session_id>` argument accepts the unique 8-hex tail alone.

## Recipes

### Summarize yesterday's conversations

```bash
Y="$(date -d yesterday +%F 2>/dev/null || date -v-1d +%F)"   # YYYY-MM-DD
penguin ls -a --json
```

- Pick the candidates from the listing: a session id starting `session-$Y-` was created yesterday; also keep earlier sessions whose last-active timestamp in the JSON falls on `$Y` — conversations that continued into yesterday.
- Read each candidate with `penguin logs <8hex> --tail 100` (widen the tail if the transcript is cut short; `--json` if you want to parse rather than read).
- Then write the summary yourself — per session: which agent, what was asked, what came of it. There is no summarize command; you are the summarizer.

### Last 7 days of cost

```bash
penguin cost                       # summary card: today, last 7 days, total
penguin cost --days 7 --by agent   # who spent it
```

- The default summary already carries the last-7-days figure; `--by` breaks a range down per `date`, `agent`, `model` or `session`.
- `--days 7 --by model` and `--days 7 --by date` answer "on which models" and "on which days"; `--from <d> --to <d>` takes an exact range; `--project-id` / `--agent-id` narrow the scope; `--json` for exact numbers.

### Create an agent and talk to it

```bash
penguin agent create --agent-id research_bot --name "Research Bot" \
  --description "Collects and digests sources" --skills firecrawl,data-analysis
penguin run --agent-id research_bot -m "Introduce yourself and list your skills."
```

- Agent ids must match `^[a-z][a-z0-9_]{1,63}$`: a lowercase letter first, then lowercase letters, digits and underscores — no hyphens.
- The new agent gets its own Agent State (system prompt, tools, skills, vault) in the current project; `--skills a,b` installs library skills at creation.
- Each `run` without `--session` opens a fresh session; reuse a session id to continue a conversation.

### Inspect an agent's scheduled tasks

```bash
penguin schedule ls --agent-id research_bot
```

Read the fields: `enabled` (a disabled entry never fires), `startAt` (first firing), `period` (recurrence; absent means one-shot), the target — an existing session id versus a new session per firing — and `lastFiredAt`.

To **create** a schedule, write a TOML file with your file tools — that is the sanctioned path: schedule files are meant to be edited directly, and your own agent's current ones are already listed in your system prompt's schedule roster. The path is `<app_data_dir>/agents/<agent_id>/agent_state/schedule/<name>.toml` (App Data Dir is in your Environment section):

```toml
prompt = "Summarize yesterday's sessions into notes/daily.md"   # required
enabled = true                       # defaults to false — set true or it never fires
start_at = "2026-08-26T09:00:00Z"    # ISO 8601, required
period = "1d"                        # e.g. 30m / 12h / 1d / 7d, minimum 5m; omit for a one-shot
# end_at = "2026-12-31T00:00:00Z"    # optional stop date
# Target — either an existing session:
# session_id = "session-2026-08-25-09-00-00-1a2b3c4d"
# ...or a new session per firing (workspace plus the provider/model_id pair):
workspace = "/home/user/project"
provider = "deepseek"
model_id = "deepseek-v4-flash"
```

The server's scheduler reconciles the folder periodically — a written file is picked up on its own; there is no register command and nothing to restart.

### Run a conversation in the background and steer it mid-flight

Two patterns; both leave you free while the conversation runs.

**(a) Background CLI process — you get a completion report.** Run the CLI itself as a background command: `exec_command` with `run_in_background: true` and the command

```bash
penguin run --agent-id research_bot -m "<long task>"
```

- The harness delivers a `[background_task_done]` report when the CLI exits — no polling needed for completion.
- Meanwhile, find the session with `penguin ls --json` (it shows as running, with the newest id) and steer it: `penguin input <session_id> -m "Focus on X; skip Y" --no-wait`.
- Peek at progress any time with `penguin logs <session_id> --tail 20`.

**(b) Server-side background — survives you.** `penguin run --background --agent-id research_bot -m "<long task>"` prints the session id and exits; the server keeps running the task with no local process.

- Poll with `penguin ls --json` (running state) and read with `penguin logs <session_id> -f` or `--tail`; steer with `penguin input` the same way.

Prefer (a) when you stay around for the result — the completion report comes to you. Prefer (b) when the work must survive your own session ending, or when fanning out many tasks without holding a process per task.

## Cautions

- **One active task per session.** `penguin input` at a busy session steers the running task rather than starting a second one; a new task sent at a busy session waits its turn. For parallel work, start parallel sessions.
- **Unattended sessions must not need a human.** Create them with `--approve allow-all` (trusted work) or `--approve read-only`; a session left on `always-ask` hangs waiting for approval in the web UI.
- **No runaway loops.** An agent that messages itself — directly, through a chain of agents, or through a schedule aimed back at its own session — keeps spending until someone stops it. Make every automated conversation terminate.
- **Spawned work bills the project.** Everything you start lands in the same project's usage (`penguin cost` shows it); a fan-out of sessions multiplies spend.
- **Configuration stays CLI-managed.** Never read or hand-edit `.project_config.toml` or `agent_state/.vault.toml` — models and secrets go through `penguin config` (see the penguin-cli skill).
