---
title: CLI Reference
description: Complete reference for the penguin command, its subcommands, and options.
---

The CLI ships as the npm package `@prismshadow/penguin-cli`; the command is `penguin`. Running bare `penguin` prints help; `-v, --version` prints the running build's one-line identity, and `penguin version --json` prints the whole of it. A `.env` file in the working directory is loaded automatically on startup.

The CLI is a thin client of the server: every session-facing command (`run`, `chat`, `ls`, `input`, `logs`, `agent`, `project`, `cost`, `schedule`, `org`) sends HTTP requests to a PenguinHarness server and renders the replies — tasks execute on the server, sessions live in its index, and the Web App sees everything the CLI creates (and vice versa). Only `config` still edits the Project's files directly, and `server` / `web` start the service itself.

## Server connection

A CLI talking to the local machine's server needs no login. The connection resolves in this order, first hit wins:

1. `--server <url>` — an explicit target.
2. `PENGUIN_API_URL` — the same, from the environment. Server-driven sessions inject it (together with `PENGUIN_API_TOKEN`, `PENGUIN_PROJECT_ID`, `PENGUIN_AGENT_ID`, `PENGUIN_SESSION_ID`) into every tool subprocess, so an agent's own `penguin` calls reach the server that runs them.
3. A live `server.lock` at the data root (`PENGUIN_HOME`, else `~/.penguin/data`): attach to the running local server.
4. Auto-start: spawn a detached local server on an ephemeral port (its output goes to `<root>/logs/server-auto-<date>.log`), wait for it, attach. If two CLIs race, the loser's spawn exits and both attach to the winner.

Authentication is the local API token: the server writes a fresh one to `<root>/api-token` (owner-only, rotated every boot), and the CLI sends it as `Authorization: Bearer`. `PENGUIN_API_TOKEN` overrides the file; the file is only read for loopback targets — connecting to a remote `--server` requires `PENGUIN_API_TOKEN` explicitly. Holding the file is admin authority by design: local filesystem access to the data root already is (the same rule `penguin server reset-admin-password` stands on).

## Global conventions

- Model references: a model's identity is always the `(provider, model_id)` pair. `--model-id` takes the upstream model id and `--provider` the group it belongs to; the provider is never inferred, guessed, or defaulted. On `run` / `chat` the pair as a whole is optional — pass both to pick a model, or neither to use the Project's default model — but passing one without the other is an error.
- Project and agent defaults: `--project-id` falls back to `PENGUIN_PROJECT_ID`, then `default_project`; `--agent-id` falls back to `PENGUIN_AGENT_ID`, then `default_agent`. Inside a server-driven session those env vars name the session's own coordinates.
- Session references: wherever a command takes a session id (`input`, `logs`, `run --session`, `chat --resume`), the full id or any unique fragment works — the 8-hex tail `penguin ls` prints is the intended shorthand. An ambiguous fragment errors listing the candidates.
- The latest-session default: where the session id is optional — `input [session_id]`, `logs [session_id]`, `chat --resume` — omitting it means **the agent's most recent session** (`--agent-id` picks whose, with the env default above). `input` and `logs` name the session they picked in a dim `[latest]` line on stderr, so the target is never ambiguous and `--json` on stdout stays parseable. When the agent has no session at all, they print one line pointing at `penguin run` / `penguin chat` and exit non-zero.
- `--json` prints raw JSON instead of the rendered/tabular output; `--server <url>` targets a specific server (see above).
- Caller-context defaults: inside a harness agent (`PENGUIN_SESSION_ID` present in the environment), a session created by `run` / `chat` defaults each **unspecified** field to the calling session's live values — the Workspace, the model pair, the approval mode and the thinking level — the same inheritance `run_subagent` applies to spawned children, so the two surfaces follow one convention. Per field the precedence is explicit flag > caller value > the plain fallback; a failed lookup prints a dim warning and falls back; outside an agent nothing changes. (`--project-id` / `--agent-id` keep their env-var defaults above.)
- `--timeout <duration>` (on `run`, `input`, and `logs -f`) bounds the wait with soft-yield semantics — the `exec_command` yield-window model applied to the CLI's wait: at expiry the command detaches cleanly and exits 0, and the task keeps running server-side for a later `penguin input` / `penguin logs` to pick up. Accepted shapes: `30s`, `5m`, `2h`, or a bare integer meaning seconds; anything else is rejected. `--timeout 0` is the degenerate window — return immediately after delivery (`{sessionId, status: "running"}` under `--json`); the one knob covers "don't wait" too. No flag = wait indefinitely. (`run --background` remains the idiomatic fire-and-forget for NEW tasks: it prints the bare session id for scripts and detaches at creation time.)
- Argument errors speak the interface language: a missing argument, a missing required option, an unknown option or a mistyped command prints one localized line plus that command's own usage and a pointer at its `--help`, and exits non-zero.
- Data root (`config` only): `--root <dir>` overrides the data root directory. Priority: `--root` > the `PENGUIN_HOME` env var > `~/.penguin/data`.

## penguin run

Create a session on the server (or reuse one), send a single message, stream and render the task until it ends, print the stats line, then exit. Exit code 0 on completed; a goal run exits 0 only when the goal outcome is `complete`.

```bash
penguin run -m "Summarize the code structure of this directory"
penguin run -m "keep going" --session 402a2e24        # reuse a session by fragment
penguin run -m "long job" --background                # returns the session id immediately
```

| Option | Description |
| --- | --- |
| `-m, --message <message>` | Required; the message to send |
| `--project-id <id>` | Project to use (default: `PENGUIN_PROJECT_ID`, else `default_project`) |
| `--agent-id <id>` | Agent to use (default: `PENGUIN_AGENT_ID`, else `default_agent`) |
| `--workspace <path>` | Workspace directory; a relative path resolves against the CLI's cwd, and the default is the cwd itself. It must exist on the server's machine — in the default local flow that is this machine |
| `--model-id <id>` | Upstream id of the model to use; requires `--provider`. Omit both to use the Project's default model |
| `--provider <group>` | Provider group of the model; required whenever `--model-id` is given |
| `--approve <mode>` | Approval mode, see below (default `allow-all`). With `--session` it PATCHes the session's sticky mode |
| `--thinking <level>` | Pins the session's thinking level (`low` / `medium` / `high` / `xhigh` / `max`) before the task; it applies from the session's next LLM request. Omitted, the session's pinned level (else the Agent config) applies |
| `--session <sessionId>` | Reuse an existing session (full id or unique fragment) instead of creating one; excludes `--workspace` and the model pair |
| `--background` | POST the task and exit immediately, printing the session id (`{"sessionId"}` under `--json`); the task keeps running on the server — follow it with `penguin logs -f` |
| `--timeout <duration>` | Soft-yield wait budget (see Global conventions): at expiry, print what has rendered plus a dim still-running line with the session id (`{sessionId, status: "running", text}` under `--json`) and exit 0 — the task is not aborted. `--timeout 0` returns right after the POST (`{sessionId, status: "running"}` under `--json`, no `text`). Excludes `--background` |
| `--goal [budget]` | Goal mode: the message is the objective and the server loops until a terminal state; the optional value is a token budget (e.g. `500k`) |
| `--json` | Print a final `{sessionId, status, text}` object instead of the rendered stream (`text` joins the main session's assistant text messages) |
| `--server <url>` | Target server (see Server connection) |

## penguin chat

Interactive REPL; each input line starts a Task. Takes the same options as `run` (minus `-m, --message`), plus:

| Option | Description |
| --- | --- |
| `--resume [sessionId]` | Resume a Session (full id or unique fragment); without an id, resumes the Agent's latest Session |
| `--verbose` | Show full tool output; by default long tool outputs are collapsed (see below) |
| `--server <url>` | Target server (see Server connection) |

With `--resume`, the Workspace and model are locked by the original Session and cannot be overridden via `--workspace` / `--model-id` / `--provider`. `--thinking` is still accepted: it re-pins the existing Session, effective from its next LLM request (mid-context changes cost the provider's cached context — compacting first is recommended). On exit, a copy-pastable `penguin chat --resume <sessionId>` command is printed.

In-REPL commands:

| Input | Behavior |
| --- | --- |
| any text while a Task runs | Mid-run steering: queued and delivered to the model between turns as a `[user_steering]` user message (a `»` acknowledgment echoes the text); rendering is held while you type so streamed output doesn't scribble over the line. If the Task finishes first, the line is sent as the next normal prompt |
| `/compact` | Proactively compact the current context |
| `/clear` | Start a fresh blank Session in place; the old Session stays on disk and can be resumed with `--resume` |
| `/thinking` | Show this Session's thinking level: the level it is pinned to (by `--thinking` or `/thinking`), else the Agent's configured level |
| `/thinking <level>` | Pin the Session's thinking level (`low` / `medium` / `high` / `xhigh` / `max`); never written back to the Agent config. Soft-limited: it applies from the next request, mid-context included — the reply advises `/compact` first, since the change invalidates the provider's cached context; subagent sessions spawned from then on inherit the pinned level |
| `/verbose` | Toggle between collapsed and full tool output |
| `/exit`, `/quit` | Quit |

Long tool outputs (an `exec_command` result, a whole file from `read_file`) are collapsed by default so they don't flood the screen: the first 4 lines stream live, and when the output finishes an elision marker (`… (+N lines, /verbose for full output)`) plus the last 4 lines are printed; outputs of up to 9 lines are shown in full. This is display-only — the model, the Trace, and the Web App always receive the complete output. `/verbose` (or starting with `--verbose`) turns collapsing off for subsequent outputs; resumed history (`--resume`) is collapsed the same way. `penguin run` never collapses: its output feeds pipes and nested CLIs.

Ctrl-C is state-dependent:

| State | Behavior |
| --- | --- |
| Awaiting tool approval | Deny that tool call |
| Task running | Abort the current Task and return to input |
| Input buffer non-empty | Clear the current input |
| Idle with empty buffer | Show an exit confirmation (y/N) |

## penguin ls

List the project's sessions — all agents, or one with `--agent-id`. Columns: short id (the 8-hex tail other commands accept as a fragment), agent, title, running/idle, last active, workspace tail. Archived sessions appear only with `-a`.

```bash
penguin ls
penguin ls --agent-id default_agent -a
penguin ls --json
```

| Option | Description |
| --- | --- |
| `--project-id <id>` / `--agent-id <id>` | Scope (see Global conventions for the defaults; without `--agent-id` every agent of the project is listed) |
| `-a, --all` | Include archived sessions |
| `--days <n>` | Only sessions whose last activity falls within the trailing n calendar days — today counts as day 1, so `--days 2` covers yesterday and today (the `cost --days` calendar semantics). Combines with `-a` and `--json` |
| `--json` / `--server <url>` | As everywhere |

## penguin input

Send a message into a session — or, without `-m`, poll its last answer. The session id is optional: omitted, it is the agent's most recent session (see Global conventions), which makes bare `penguin input` the answer to "what did my agent last say". With `-m`, a running session receives the text as steering (delivered between turns) and an idle one gets a new task; by default the command waits and renders until the turn completes, and `--timeout` bounds the wait (soft yield — see Global conventions; `--timeout 0` returns right after delivery).

Without `-m`, the command is a **poll**, mirroring `input_subagent`'s empty-prompt semantics: it prints the session's most recent complete assistant text (an idempotent last-answer snapshot from the history tail; thinking and tool output are skipped), queueing and steering nothing. A running session is waited on silently first — bounded by `--timeout` when given, with `--timeout 0` snapshotting immediately — and if it is still running at expiry, the current latest text is printed together with the still-running note (exit 0).

```bash
penguin input 402a2e24 -m "also check the tests"
penguin input 402a2e24 -m "queue this" --timeout 0    # deliver and return immediately
penguin input 402a2e24                    # poll: print the last assistant reply
penguin input                             # poll the agent's most recent session
penguin input 402a2e24 --timeout 5m       # poll, waiting out a running turn up to 5 minutes
```

| Option | Description |
| --- | --- |
| `-m, --message <text>` | The message text; omit it to poll the last assistant reply instead |
| `--timeout <duration>` | Soft-yield wait budget: with `-m`, detach at expiry like `run` (`{sessionId, status: "running", text}` under `--json`), and `--timeout 0` returns right after delivery (`{sessionId, status: "running"}`); without `-m`, take the snapshot at expiry — `0` immediately — and note the session is still running |
| `--project-id <id>` | Fragment-search scope (a full session id needs none) |
| `--agent-id <id>` | Whose most recent session the omitted session id means |
| `--json` / `--server <url>` | As everywhere; `--json` with `-m` prints `{sessionId, status, text}` (status `completed` / `aborted` / `running`; the `--timeout 0` shape drops `text`), and the poll form `{sessionId, status, text}` with status `idle` / `running` (text `""` when there is no reply yet) |

## penguin logs

Render a session's history through the same renderer the REPL uses. The session id is optional: omitted, it is the agent's most recent session (see Global conventions), so bare `penguin logs` shows what just happened.

```bash
penguin logs                    # the agent's most recent session
penguin logs 402a2e24 --tail 20
penguin logs 402a2e24 -f
```

| Option | Description |
| --- | --- |
| `--tail <n>` | Show only the last n entries |
| `-f, --follow` | Keep following the live stream after the history (read-only; Ctrl-C detaches without touching the session) |
| `--timeout <duration>` | Stop following after this long (soft yield, exit 0); only meaningful with `-f` |
| `--project-id <id>` | Fragment-search scope |
| `--agent-id <id>` | Whose most recent session the omitted session id means |
| `--json` / `--server <url>` | As everywhere; `--json` prints the raw message array (and, with `-f`, one JSON message per line as they arrive) |

## penguin agent

```bash
penguin agent ls
penguin agent create --agent-id helper --name "Helper" --plugins software-development,goal
```

`agent ls` lists the project's agents (id, name, session count, description). `agent create` creates one:

| Option | Description |
| --- | --- |
| `--agent-id <id>` | Required; the agent id (directory name) |
| `--name <s>` / `--description <s>` | Display name and description |
| `--plugins <a,b>` | Comma-separated library plugin names to preinstall (each one's skills and hook package); unknown names are rejected before anything is created |
| `--project-id <id>` / `--json` / `--server <url>` | As everywhere |

## penguin project

`penguin project ls` lists the projects this account can reach (own and shared), with id, display name and role. `--json` / `--server` as everywhere.

## penguin cost

Token usage and cost from the server's usage aggregates. The default prints the summary card — today / last 7 days / total (computed regardless of any range) — and `--by` prints a grouped table instead.

```bash
penguin cost
penguin cost --days 7 --by model
penguin cost --from 2026-08-01 --to 2026-08-25 --by agent
```

| Option | Description |
| --- | --- |
| `--days <n>` | Trailing window of n days (sets from/to) |
| `--from <d>` / `--to <d>` | Explicit range (`yyyy-mm-dd`, always as a pair) |
| `--by <dim>` | Group by `date`, `agent`, `model` or `session` |
| `--project-id <id>` / `--agent-id <id>` | Scope; `--agent-id` filters (no default agent here — costs are a project view unless narrowed) |
| `--json` / `--server <url>` | As everywhere |

A `+` after a cost marks a partial sum (some model in the bucket has no pricing configured); `-` means no priced usage at all.

## penguin schedule

`penguin schedule ls` lists the project's scheduled tasks — all agents, or one with `--agent-id`. Columns: agent, name, enabled, start time, period (`once` for one-shot tasks), target (a bound session's short id or `new session`), last fired, and a status marker for every non-active state (`expired` / `done` / `missed` / `invalid`; unparsable schedule files are listed too, marked invalid). `--json` / `--server` as everywhere.

`add` / `update` / `rm` manage schedules through the API, which writes the schedule's TOML file — **the file remains the single source of truth**, and the CLI is a validated writer (the same pattern model config and the vault follow: updates go through the system interface, validation converges at the interface layer, and hand edits stay possible). API errors surface verbatim, so an agent gets synchronous validation instead of the reconcile lag a hand edit hits.

```bash
penguin schedule add daily-report --prompt "summarize the day" --start-at 2026-09-01T09:00:00Z --period 1d
penguin schedule add once-now --prompt "check the deploy" --start-at now --session-id 402a2e24
penguin schedule update daily-report --period 12h --disable
penguin schedule rm daily-report
```

| Option | Description |
| --- | --- |
| `--prompt <s>` | The text each firing sends (required on `add`) |
| `--start-at <ISO\|now>` | First fire time, ISO 8601, or the literal `now` for the current instant (required on `add`) |
| `--period <dur>` | Fixed interval, minimum `5m` (e.g. `30m`, `12h`, `1d`, `7d`); omitted = one-shot |
| `--end-at <ISO>` | Stop firing after this instant |
| `--session-id <id>` | Bind firings to one session — XOR with the new-session form below |
| `--workspace <path>` / `--model-id <id> --provider <p>` | New-session mode: each firing creates a session on this workspace/model (workspace omitted = a temp workspace; the model pair is both-or-neither, omitted = the Project default) |
| `--disabled` (`add`) | One deliberate divergence from the raw file: `add` creates the task **enabled** — you are adding a task to run — while the raw-file default of `enabled = false` stays for hand edits. `--disabled` opts out |
| `--enable` / `--disable` (`update`) | Flip the enabled flag; `update` is read-modify-write against the stored item, so unspecified fields keep their values, and switching target kinds clears the other kind's fields |
| `--project-id` / `--agent-id` / `--json` / `--server` | As everywhere; `rm` deletes without prompting (the server's owner authorization still applies) |

## penguin org

Company mode's command family — a thin client over the organization API. An organization's files under the Project directory (the employee tree, the desks ledger, calendar, tickets, chat) stay the single source of truth; every subcommand reads a projection of them or writes through the route that edits them, with the same validated-writer contract `schedule` has: API errors surface verbatim, so an agent gets synchronous validation instead of the reconcile lag a hand edit hits.

```bash
penguin org ls [--project-id <id>] [--json]
penguin org create --org-id <id> --mission <s> [--name <s>] [--project-id <id>]
penguin org show [--org-id <id>] [--json]                       # overview: employees and states, board counts, spend against budget, pending items
penguin org chart [--org-id <id>] [--json]                      # the employee tree
penguin org hire (--agent-id <id> | --new-agent <id> [--name <s>] [--description <s>] [--skills <a,b>]) --title <s> --reports-to <agent_id> [--workspace <path>] [--budget <usd>] [--duties <s>]
penguin org employee set <agent_id> [--title <s>] [--reports-to <agent_id>] [--workspace <path>] [--budget <usd>] [--duties <s>] [--model-id <id> --provider <p>]
penguin org leave <agent_id>                                    # out of the organization (not the CEO); the Agent itself stays
penguin org desk show [<agent_id>] [--json]                     # the desk session id and Workspace (opens the desk if there is none)
penguin org desk renew [<agent_id>]                             # a fresh desk session (resets the context)
penguin org calendar ls [--agent-id <id>] [--json]
penguin org calendar add <name> [--agent-id <id>] --prompt <s> --start-at <ISO|now> [--period <dur>] [--end-at <ISO>] [--title <s>] [--disabled]
penguin org calendar update <name> [--agent-id <id>] [same fields] [--enable|--disable]
penguin org calendar rm <name> [--agent-id <id>]
penguin org ticket ls [--status <col>] [--owner <principal>] [--blocked] [--json]
penguin org ticket show <ticket_id> [--json]
penguin org ticket create --title <s> (--goal <s> [--criteria <s>] | --body-file <path>) [--owner <principal>] [--parent <ticket_id>] [--notify <p,p>] [--priority P0|P1|P2] [--due <date>]
penguin org ticket move <ticket_id> --to <col> [--reason <s>]   # moving into rejected needs a reason
penguin org ticket assign <ticket_id> --owner <principal>
penguin org ticket block <ticket_id> --reason <s> [--by <principal|ticket_id>]   # the ticket stays in its column
penguin org ticket unblock <ticket_id>
penguin org ticket progress <ticket_id> -m <text>               # a progress entry, attributed to the calling session
penguin org ticket start <ticket_id> [-m <note>] [--workspace <path>] [--json]   # a ticket session working on the ticket in the background; prints its id
penguin org ticket attach <ticket_id> [--session <session_id>]   # an existing session as a contributor (default: the calling session)
penguin org chat tail [--date <d>] [-n <count>] [--json]
penguin org chat send -m <text> [--ref-ticket <id>] [--ref-session <id>]
penguin org finance [--period <YYYY-MM>] [--json]
```

Every subcommand takes `--org-id <id>`, `--project-id`, `--json` and `--server`. **`--org-id` defaults to `PENGUIN_ORG_ID`**, the one variable company mode adds to the control environment described under "Server connection": the server injects it into every tool subprocess of a desk or ticket session, so an employee's own `penguin org` calls address its organization without naming it, while a person in a shell passes the flag. There is no default organization — with neither, the command fails before contacting any server. `create` is the exception: its `--org-id` is the id to create and never comes from the environment. `--json` prints the response as one line of JSON; the write commands otherwise print a one-line confirmation.

The same environment identifies the caller inside a session:

- `--agent-id` on the `calendar` commands and the positional of `desk` default to `PENGUIN_AGENT_ID` — an employee schedules its own events and renews its own desk. `calendar ls` without the flag lists every employee's events.
- `ticket start` runs the ticket session as `PENGUIN_AGENT_ID` when it is set; otherwise the server picks the ticket's owner.
- The ticket writes (`create`, `assign`, `move`, `block`, `unblock`, `progress`) and `chat send` carry `PENGUIN_SESSION_ID`, so the file records the session's employee rather than the token's user; `ticket attach` attaches that session when `--session` is omitted (a full id or a unique fragment, as everywhere).

Per group:

- `ls` / `show` / `chart`: the project's organizations with employee, ticket and spend counts; one organization's overview — name, mission and status, employees by state, tickets per column, the period's spend against the CEO's budget, and what waits for you (mentions, tickets to review, tickets blocked on you); and the reporting tree, indented by level, with each employee's title, live state, own and cumulative spend and budget. An organization or employee that fails validation is listed with `invalid: <reason>` rather than hidden.
- `hire`: exactly one of `--agent-id` (an existing Agent) and `--new-agent` (creates it; `--name`, `--description` and `--skills` — the new Agent's library plugins, replacing the default `agent-company,agent-development` — describe it). `--workspace` is written as given: a sub-directory of the organization's shared workspace (`.` for all of it) or an absolute path, not resolved against the CLI's cwd. `--budget` is USD per month for the employee plus everyone below it. `employee set` changes only the given fields; the model pair is both-or-neither, as everywhere.
- `calendar`: the same writer as `penguin schedule` — `add` is enabled by default with `--disabled` opting out, `--start-at now` is the current instant, `update` is read-modify-write, `rm` deletes without prompting. Events fire into the employee's desk session, and only while the organization and the employee are active; the status column says `paused` otherwise.
- `ticket`: `ls` fetches the whole board and filters locally (`--status` is a column: `proposed`, `in_progress`, `review`, `done`, `rejected`); `show` prints the derived figures — column, running state, cost and rolled-up cost, contributing sessions, child tickets — then the ticket file itself. `create` takes either `--goal` (with `--criteria`) or the whole Markdown body from `--body-file`; the header is generated either way. Under `--json`, `ls` prints the filtered list as `{ tickets, invalidFiles }`. `start` prints the bare session id, like `run --background`, for `penguin logs` / `penguin input` to pick up.
- `chat tail` prints the day's last 20 messages (`-n` changes the count, `--date` picks another day) as `time  sender  text` — under `--json`, the day's response with those messages; `chat send` posts one — `@agent:<id>` and `@all` mentions trigger the mentioned employees' desks.
- `finance`: the period's spend per employee (own and cumulative along the reporting line, against the budget, with `warned` / `paused` marks) and per ticket, then the total; when some usage ran on a model without pricing, a note on stderr says the figures are a lower bound.

## Approval modes (--approve)

| Mode | Behavior |
| --- | --- |
| `allow-all` | Auto-approve every tool call (default) |
| `deny-all` | Auto-reject every tool call |
| `read-only` | Auto-approve read-only tools; prompt for the rest |
| `always-ask` | Prompt for every tool call |

At an interactive prompt, `y` / `yes` approves and `n` / `no` denies; a bare Enter defaults to approve.

## penguin config

Manages a Project's model configuration, per-Agent vault environment variables, and the UI language. Except for `lang`, all subcommands below accept `--project-id <id>` (defaults to the default Project) and `--root <dir>`.

### model add

Add or update a model entry:

```bash
penguin config model add --provider deepseek --model-id deepseek-v4-pro --api-key sk-... --set-default
```

| Option | Description |
| --- | --- |
| `--model-id <id>` | Required; the upstream model id |
| `--provider <group>` | Required; the provider group the entry belongs to. It is never derived from the model id: gateways resell vendor models under their upstream ids, so a guessed group would write the credential onto another vendor's endpoint. Use `custom` for any endpoint outside the built-in groups. |
| `--api-key <key>` | API key, stored inline in the Project's hidden `.project_config.toml` |
| `--base-url <url>` | Custom endpoint base URL |
| `--context-window <n>` | Context window size |
| `--max-tokens <n>` | Per-model max output tokens (positive integer). Overrides the Agent's `model.max_tokens` when set; omit to inherit — lower it for small-context models |
| `--client-type <type>` | Client protocol type |
| `--vision` / `--no-vision` | Mark vision input as supported / unsupported |
| `--fast-mode` / `--no-fast-mode` | Enable / disable fast mode (faster output at premium pricing; off by default). Enabling it on a model whose AgentHub client rejects the parameter still writes the entry but warns on stderr. Omit both to keep the current value |
| `--price-cache-read <n>` | Cache-read price |
| `--price-cache-write <n>` | Cache-write price |
| `--price-output <n>` | Output price |
| `--set-default` | Also set as the default model |

### model default / model vision / model list / model remove

```bash
penguin config model default --model-id <id> --provider <group>
penguin config model vision --model-id <id> --provider <group>
penguin config model list
penguin config model remove --model-id <id> --provider <group>
```

- `model default` sets the Project's default model; `model vision` sets the vision proxy model. Both require `--model-id` and `--provider`, and the reference must already exist in the model list.
- `model list` lists configured models; the default model is marked with `*`.
- `model remove` deletes a model entry along with the credential stored inline on it. It requires `--model-id` and `--provider` — the pair is matched exactly, so the same upstream id under another group is left alone — and exits non-zero if the pair is not in the config. When the removed entry was the default model or the vision model, that setting is cleared: a pointer left naming a model that is no longer configured would fail the next session outright.

### vault

Per-Agent environment variable store, written to `agent_state/.vault.toml`. Values are injected into tool subprocess environments only — never into the model context.

```bash
penguin config vault set --key GITHUB_TOKEN --value ghp_xxx
penguin config vault list
penguin config vault remove --key GITHUB_TOKEN
```

| Subcommand | Options |
| --- | --- |
| `vault set` | `--key <name>` (required), `--value <value>` (required), `[--agent-id <id>]` |
| `vault list` | `[--agent-id <id>]` |
| `vault remove` | `--key <name>` (required), `[--agent-id <id>]` |

### lang

```bash
penguin config lang en
```

Sets the CLI UI language (`en` or `zh`) by writing `PENGUIN_LANG` into the shell startup file.

## penguin server / penguin web

Two entry points into the same service process: `server` runs headless; `web` additionally waits for readiness, prints the URL, and opens the browser.

```bash
penguin web
```

| Option | Description |
| --- | --- |
| `--port <port>` | Listen port, default 7364 |
| `--host <host>` | Listen host, default 127.0.0.1 |
| `--no-open` | `web` only: do not open the browser |

Port / host priority: command-line option > the `PORT` / `HOST` env vars (including `.env`) > defaults.

Both run the service as a child process and stay behind as its supervisor: the terminal's Ctrl+C reaches the service, the command exits with the service's exit code, and when the service asks to be restarted — the Web App's **Restart and update** after `penguin update` has replaced the install — the supervisor relaunches it on the new release, printing a line as it does. A dev run through `tsx` cannot be relaunched by plain node and runs the service in-process instead; the Web App then tells the admin to restart by hand.

### penguin server reset-admin-password

Offline rescue when the Web admin password is forgotten. Run it with the server stopped — it refuses while one is running on the data root:

```bash
penguin server reset-admin-password
```

The built-in `admin` is returned to the unclaimed state — a random password nobody ever sees, and every one of admin's sessions revoked. Start the server again and open the first-login link it prints to set a new password; nothing is written down in the meantime. Other accounts are reset by the admin on the user-management page; this command only touches `admin`. The data root is selected by `PENGUIN_HOME` as usual.

## penguin version

Reports which build is running. The version number alone cannot answer that — every build made from a checkout between two releases also calls itself `0.2.3` — so a release and a source build identify themselves differently.

```bash
penguin version          # v0.2.3            (a release)
penguin version          # v0.2.3-14-g9e8f7d6-dirty   (built from a checkout)
penguin version --json   # the full build info
```

| Option | Description |
| --- | --- |
| `--json` | Print the full version report instead of the one line: `{version, describe, channel, buildDate, commit, branch, dirty, runtime, harness}` |
| `--root <dir>` | Data root whose HMR store to report as `harness`. Priority: `--root` > `PENGUIN_HOME` > `~/.penguin/data` |

The bare form prints one line, which for a source build is `git describe --tags --dirty` output — `v0.2.3-14-g9e8f7d6-dirty` reads as fourteen commits past `v0.2.3`, at `9e8f7d6`, with uncommitted changes. `-v, --version` prints that same line.

`describe` names the nearest reachable git tag, which is not always `v` + `version`: release preparation bumps `version` in its own commit and creates the tag afterwards, so a build from that window reports `v0.2.3-14-g9e8f7d6` while `version` already reads `0.2.4`. Read `version` for the release number and `describe` for the position in history.

The JSON is the same record `GET /api/version` returns, so a bug report can be gathered from either side of the HTTP boundary. In it, `channel` is `release` or `source`; `buildDate` and `commit` are stamped into the build by the release workflow and are null for a source build; `branch` and `dirty` describe a source build's git position and are null for a release, where the question does not apply — the workflow stamps its constants into the tree before building.

### harness: what was hot-pushed here

`harness` describes the data root's HMR store — the harness code a hot update committed, which a restart resumes. It is null when nothing was ever pushed to that root.

```json
"harness": {
  "source": { "repo": "…/penguin-harness", "revision": "v0.2.3-7-gabc1234-dirty" },
  "pushedAt": "2026-08-20T10:15:00.000Z",
  "bundles": { "platform": "store/platform/…", "cli": "store/cli/…", "web": "store/web/…" }
}
```

This is the one thing the version line cannot report. A pushed bundle lands outside any checkout, so it identifies itself by the version it was compiled from and nothing more; `source.revision` — recorded by the pusher, spelled the same way as `describe` — is the only thing that names the revision behind it. `bundles` holds the committed artifacts' content-addressed pointers, which identify the pushed code itself regardless of what the pusher claimed about it.

It describes the store, not the process: `penguin` runs the packaged CLI while `penguin-hmr` runs the store's, so a non-null `harness` does not by itself mean the command printing it is the pushed code. `source` is null for a version pushed by a client that recorded no provenance, including anything pushed before it was recorded at all.

An installed penguin never shells out to git: it reads constants stamped into the build. A release gets them from the release workflow; every other build gets its git position inlined by the bundler that produced it, so an artifact still identifies itself after it has left the checkout it came from — a hot-pushed bundle under `<root>/hmr/store/` reports the revision it was built at, on a machine with no checkout and no git installed. Asking git at run time is only the fallback, for an un-bundled `tsx` run; even then it asks about its own checkout, so `penguin version` inside an unrelated repository reports the harness's revision and not that repository's.
## penguin auth

Signs in to a running PenguinHarness server from the terminal. This is the only part of the CLI that talks to a server as a client — `config`, `run` and `chat` all work on the data root directly.

Two ways in, and which is right depends on where you are standing.

```bash
penguin auth login                      # password, against the server on this data root
penguin auth login --server https://penguin.example --user-id alice
penguin auth status
penguin auth logout
penguin auth token                      # no password: minted from this data root
```

`login` takes a password and asks a running server for a session, exactly as the browser's login page does. The target defaults to the server running on this data root (read from its lock file), so signing in to your own needs no URL.

Run interactively it asks for the account first, then the password — and the password prompt names the account, so one account's password is never typed at another's. Supply the password non-interactively (`--password` or `PENGUIN_PASSWORD`) and neither question is asked: that is a script, and a script cannot answer one.

| Option | Description |
| --- | --- |
| `--server <url>` | Server to sign in to; default the one running on this data root |
| `--user-id <id>` | Account; asked for when omitted, defaulting to `admin` on a bare Enter |
| `--password <pw>` | Password; also read from `PENGUIN_PASSWORD`, otherwise prompted without echo |
| `--print` | Also print the session token to stdout, for piping |

Prefer `PENGUIN_PASSWORD` or the prompt over `--password`: a command line is world-readable through `ps`.

`token` takes no password at all. It writes a session row straight into the data root's `web.db`, and what authorizes it is that you can read and write that root — which already holds every credential the token could reach. That makes it the **data root owner's** tool: on a multi-user deployment the root belongs to the OS account running the server, and everyone else signs in with `auth login` instead. Use it where there is no password to give: a machine whose admin password somebody set by hand, a script that must not hold one, or a controller reaching a managed machine over ssh.

| Option | Description |
| --- | --- |
| `--user-id <id>` | Account, default `admin` |
| `--ttl-seconds <n>` | Lifetime, default 3600 |
| `--mark` | Print a fixed marker line before the token — for a caller parsing it out of a shell whose login profile may print a banner |

The session is written to `<root>/cli-session.json` at mode 0600, which is what `status` reads and `logout` revokes and deletes. `logout` tells the server first, so the session dies there rather than merely being forgotten here; if the server cannot be reached it says so, and the local file goes anyway.

## penguin update

Upgrades this install in place, using the mechanism it was installed with. The install kind is detected from the real path of the running CLI, never guessed.

```bash
penguin update --check     # report versions only
penguin update             # upgrade to the latest release, after confirming
```

| Option | Description |
| --- | --- |
| `--check` | Only report the installed and latest versions; change nothing. Exit code is 0 either way |
| `--release <tag>` | Target a specific release instead of the latest (`v0.1.2` or `0.1.2`); older tags are allowed and reported as a downgrade |
| `-y, --yes` | Skip the confirmation prompt |

The target flag is `--release`, not `--version`, because `-v, --version` is the CLI's own version flag and would take precedence.

Release discovery and tarball downloads honor `PENGUIN_DOWNLOAD_SOURCE=auto|oss|github`, using the same policy as the stable installer entry point. The default `auto` mode reads the OSS `latest.json`, prefers that immutable release, and falls back to the matching GitHub tag; the package itself is then served by whichever source the installer's speed probe picks. Forced `oss` and `github` modes are strict; `--release <tag>` skips latest-version discovery while retaining the selected source policy. An explicit HTTPS `PENGUIN_DOWNLOAD_BASE_URL` has highest priority for installer and payload downloads, with an optional `PENGUIN_DOWNLOAD_FALLBACK_BASE_URL` for the payload.

| Install kind | How it upgrades |
| --- | --- |
| Tarball (`install.sh`, default `~/.penguin`) | Re-runs the official installer, preserving the install dir and whether the package bundles a Node runtime |
| Global npm/pnpm/yarn/bun install | Runs that manager's global install of `@prismshadow/penguin-cli@<target>`; if the manager cannot be identified, prints the command instead of guessing |
| Source checkout | Refused — update it with `git pull` and a rebuild |

Without `-y` the command prints exactly what it will do — mechanism, target version and install dir — and asks for confirmation; when stdin is not a terminal it requires `--yes` rather than waiting on a prompt nobody can answer. **The data root is never touched**: an upgrade only replaces `bin`, `lib`, `web` and `node`. Neither path upgrades in place on Windows: the installer is a POSIX shell script, and a global install cannot be driven from here because Node will not execute an `npm`/`pnpm` `.cmd` shim without a shell — so the command prints the exact command to run yourself instead.

See also: [Configuration Reference](/configuration), [Models & Providers](/models).
