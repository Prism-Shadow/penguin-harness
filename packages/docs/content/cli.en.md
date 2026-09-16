---
title: CLI Reference
description: Every penguin command and subcommand, with its options, defaults, output shapes and examples.
---

This page documents every `penguin` command. It opens with how the CLI reaches a server and the conventions all commands share, then gives each command a summary, its usage, an options table and examples.

The CLI ships as the npm package `@prismshadow/penguin-cli`, and the command is `penguin`. Bare `penguin` prints help. `-v, --version` prints the running build's one-line identity, and `penguin version --json` prints all of it. On startup the CLI loads a `.env` file from the working directory.

The CLI is a thin client of the server. Every session-facing command (`run`, `chat`, `ls`, `input`, `logs`, `agent`, `project`, `cost`, `schedule`, `org`) sends HTTP requests to a PenguinHarness server and renders the replies. Tasks run on the server, Sessions live in its index, and the Web App sees everything the CLI creates, and the other way round. Only `config` still edits the Project's files directly, and `server` / `web` start the service itself.

## Server connection

A CLI that talks to the server on the local machine needs no login. The CLI picks its server in this order, and the first match wins:

1. `--server <url>`: an explicit target.
2. `PENGUIN_API_URL`: the same, from the environment. Server-driven sessions inject it into every tool subprocess, together with `PENGUIN_API_TOKEN`, `PENGUIN_PROJECT_ID`, `PENGUIN_AGENT_ID` and `PENGUIN_SESSION_ID`, so an agent's own `penguin` calls reach the server that runs them.
3. A live `server.lock` at the data root (`PENGUIN_HOME`, else `~/.penguin/data`): the CLI attaches to the running local server.
4. Auto-start: the CLI spawns a detached local server on an ephemeral port, waits for it and attaches. The server's output goes to `<root>/logs/server-auto-<date>.log`. If two CLIs race, the losing spawn exits and both attach to the winner.

The CLI authenticates with the local API token. The server writes a fresh token to `<root>/api-token` on every boot (owner-only), and the CLI sends it as `Authorization: Bearer`. `PENGUIN_API_TOKEN` overrides the file. The CLI reads the file only for loopback targets, so a remote `--server` needs `PENGUIN_API_TOKEN` set explicitly. Holding the file grants admin authority by design, because local filesystem access to the data root already does. `penguin server reset-admin-password` relies on the same rule.

## Global conventions

- Model references: a model's identity is always the `(provider, model_id)` pair. `--model-id` takes the upstream model id and `--provider` the group it belongs to. The CLI never infers, guesses or defaults the provider. On `run` and `chat` the pair as a whole is optional: pass both to pick a model, or neither to use the Project's default model. Passing only one is an error.
- Project and agent defaults: `--project-id` falls back to `PENGUIN_PROJECT_ID`, then `default_project`. `--agent-id` falls back to `PENGUIN_AGENT_ID`, then `default_agent`. Inside a server-driven session, those variables name the session's own Project and agent.
- Session references: wherever a command takes a session id (`input`, `logs`, `run --session`, `chat --resume`), the full id or any unique fragment works. The 8-hex tail that `penguin ls` prints is the intended shorthand. An ambiguous fragment is an error that lists the candidates.
- Latest-session default: where the session id is optional (`input [session_id]`, `logs [session_id]`, `chat --resume`), omitting it means the agent's most recent Session, and `--agent-id` picks the agent. `input` and `logs` name the Session they picked in a dim `[latest]` line on stderr, so the target is always clear and `--json` output on stdout stays parseable. When the agent has no Session at all, they print one line pointing at `penguin run` / `penguin chat` and exit non-zero.
- JSON output: `--json` prints raw JSON instead of rendered or tabular output.
- Target server: `--server <url>` targets a specific server. See [Server connection](#server-connection).
- Caller-context defaults: inside a harness agent (`PENGUIN_SESSION_ID` is set), a Session created by `run` or `chat` takes each unspecified field from the calling Session's live values: the Workspace, the model pair, the approval mode and the thinking level. `run_subagent` applies the same inheritance to the children it spawns, so both surfaces follow one convention. For each field, an explicit flag wins over the caller's value, which wins over the plain fallback. A failed lookup prints a dim warning and uses the plain fallback. Outside an agent nothing changes, and `--project-id` / `--agent-id` keep their environment-variable defaults.
- Timeouts: `--timeout <duration>` on `run`, `input` and `logs -f` bounds the wait with soft-yield semantics, the `exec_command` yield-window model applied to the CLI. At expiry the command detaches cleanly and exits 0. The Task keeps running on the server, and a later `penguin input` or `penguin logs` can pick it up. Accepted values are `30s`, `5m`, `2h`, or a bare integer meaning seconds; anything else is rejected. `--timeout 0` returns immediately after delivery (`{sessionId, status: "running"}` under `--json`), so the same option also covers "don't wait". Without the option, the command waits indefinitely. For new Tasks, `run --background` remains the usual fire-and-forget: it prints the bare session id for scripts and detaches as soon as the Task is created.
- Argument errors: a missing argument, a missing required option, an unknown option or a mistyped command prints one line in the interface language, the command's own usage and a pointer to its `--help`, then exits non-zero.
- Data root: `--root <dir>` sets the data root for the commands that read it directly: `config`, `auth`, `version`, `server status` and `server stop`. A relative path resolves against the working directory. Priority: `--root`, then the `PENGUIN_HOME` environment variable, then `~/.penguin/data`.

## penguin run

Creates a Session on the server (or reuses one), sends one message, streams and renders the Task until it ends, prints the stats line and exits. The exit code is 0 when the Task completes and 1 when it is aborted. A goal run exits 0 only when the goal outcome is `complete`.

```bash
penguin run -m <message> [options]
```

| Option | Description | Default |
| --- | --- | --- |
| `-m, --message <message>` | The message to send. Required. | — |
| `--project-id <id>` | Project to use. | `PENGUIN_PROJECT_ID`, else `default_project` |
| `--agent-id <id>` | Agent to use. | `PENGUIN_AGENT_ID`, else `default_agent` |
| `--workspace <path>` | Workspace directory. A relative path resolves against the CLI's working directory. The directory must exist on the server's machine, which in the default local setup is this machine. | The working directory |
| `--model-id <id>` | Upstream id of the model to use. Requires `--provider`. | The Project's default model |
| `--provider <group>` | Provider group of the model. Required with `--model-id`. | — |
| `--approve <mode>` | Approval mode; see [Approval modes (--approve)](#approval-modes---approve). With `--session`, it PATCHes the Session's sticky mode. | `allow-all` |
| `--thinking <level>` | Pins the Session's thinking level (`low` / `medium` / `high` / `xhigh` / `max`) before the Task. It applies from the Session's next LLM request. | The Session's pinned level, else the agent config |
| `--session <sessionId>` | Reuses an existing Session (full id or unique fragment) instead of creating one. Cannot be combined with `--workspace` or the model pair. | — |
| `--source <source>` | Marks the new Session as created by a Benchmark evaluation. The only value is `benchmark`, and the Web App files such Sessions under the Evaluations folder of the session list. Cannot be combined with `--session`. | — |
| `--background` | POSTs the Task and exits immediately, printing the session id (`{"sessionId"}` under `--json`). The Task keeps running on the server; follow it with `penguin logs -f`. | — |
| `--timeout <duration>` | Soft-yield wait budget; see [Global conventions](#global-conventions). Cannot be combined with `--background`. | Wait indefinitely |
| `--goal [budget]` | Goal mode: the message is the objective, and the server loops until the goal reaches a terminal state. The optional value is a token budget, such as `500k`. | — |
| `--json` | Prints a final `{sessionId, status, text}` object instead of the rendered stream. `text` joins the main Session's assistant text messages. | — |
| `--server <url>` | Target server; see [Server connection](#server-connection). | — |

When `--timeout` expires, `run` prints what has rendered so far and a dim still-running line with the session id, then exits 0 without aborting the Task. Under `--json` it prints `{sessionId, status: "running", text}`. `--timeout 0` returns right after the POST, and under `--json` prints `{sessionId, status: "running"}` with no `text`. For a goal run, the `status` in the final JSON object is the goal outcome.

Ctrl-C at an approval prompt denies that tool call. At any other time it aborts the Task on the server.

```bash
penguin run -m "Summarize the code structure of this directory"
penguin run -m "keep going" --session 402a2e24        # reuse a session by fragment
penguin run -m "long job" --background                # returns the session id immediately
```

## penguin chat

Starts an interactive REPL, where each input line starts a Task.

```bash
penguin chat [options]
```

| Option | Description | Default |
| --- | --- | --- |
| `--project-id <id>` / `--agent-id <id>` | Project and agent to use, as on `run`. | See [Global conventions](#global-conventions) |
| `--workspace <path>` | Workspace directory, as on `run`. | The working directory |
| `--model-id <id>` / `--provider <group>` | Model pair, as on `run`. | The Project's default model |
| `--approve <mode>` | Approval mode; see [Approval modes (--approve)](#approval-modes---approve). | `allow-all` |
| `--thinking <level>` | Pins the Session's thinking level, as on `run`. | The Session's pinned level, else the agent config |
| `--resume [sessionId]` | Resumes a Session (full id or unique fragment). Without an id, resumes the agent's latest Session. | — |
| `--verbose` | Shows full tool output instead of collapsing long outputs; see [Tool output collapsing](#tool-output-collapsing). | Long outputs collapsed |
| `--server <url>` | Target server; see [Server connection](#server-connection). | — |

With `--resume`, the original Session fixes the Workspace and model, so `--workspace`, `--model-id` and `--provider` cannot override them. `--thinking` is still accepted: it re-pins the existing Session from its next LLM request. Changing the level mid-context costs the provider's cached context, so compact first. On exit, if the Session has any history, the REPL prints a copy-pastable `penguin chat --resume <sessionId>` command.

### In-REPL commands

| Input | Behavior |
| --- | --- |
| Any text while a Task runs | Mid-run steering. The line is queued and reaches the model between turns as a `[user_steering]` user message, and a `»` acknowledgment echoes the text. Rendering pauses while you type, so streamed output does not overwrite the line. If the Task finishes first, the line is sent as the next normal prompt. |
| `/goal[:<budget>] <objective>` | Runs goal mode on the objective. The optional budget is a token budget, such as `/goal:500k`. Ctrl-C aborts the whole goal. See [Goal mode](/goal-mode). |
| `/compact` | Compacts the current context now. |
| `/clear` | Starts a fresh blank Session in place, on the same Workspace and model. The old Session stays on the server and can be resumed with `--resume`. |
| `/thinking` | Shows this Session's thinking level: the level pinned by `--thinking` or `/thinking`, else the agent's configured level. |
| `/thinking <level>` | Pins the Session's thinking level (`low` / `medium` / `high` / `xhigh` / `max`). The level is never written back to the agent config. |
| `/verbose` | Switches between collapsed and full tool output. |
| `/exit`, `/quit` | Quits. |

A pinned thinking level is soft-limited: it applies from the next request, even mid-context. The reply advises running `/compact` first, because the change invalidates the provider's cached context. Subagent Sessions spawned after the change inherit the pinned level.

### Tool output collapsing

Long tool outputs, such as an `exec_command` result or a whole file from `read_file`, are collapsed by default so they do not flood the screen. The first 4 lines stream live. When the output finishes, the REPL prints an elision marker (`… (+N lines, /verbose for full output)`) and the last 4 lines. Outputs of up to 9 lines appear in full.

Collapsing only affects the display: the model, the Trace and the Web App always receive the complete output. `/verbose`, or starting with `--verbose`, turns collapsing off for later outputs. History shown by `--resume` is collapsed the same way. `penguin run` never collapses output, because its output feeds pipes and nested CLIs.

### Ctrl-C

What Ctrl-C does depends on the REPL's state:

| State | Behavior |
| --- | --- |
| Awaiting tool approval | Denies that tool call. |
| Task running | Aborts the current Task and returns to input. |
| Input buffer not empty | Clears the current input. |
| Idle with an empty buffer | Shows an exit confirmation (y/N). |

## penguin ls

Lists the Project's Sessions, for all agents or for one with `--agent-id`. Columns: short id (the 8-hex tail other commands accept as a fragment), agent, title, running/idle, last active and the end of the Workspace path. Archived Sessions appear only with `-a`.

```bash
penguin ls [options]
```

| Option | Description | Default |
| --- | --- | --- |
| `--project-id <id>` / `--agent-id <id>` | Scope. Without `--agent-id`, every agent of the Project is listed. | See [Global conventions](#global-conventions) |
| `-a, --all` | Includes archived Sessions. | — |
| `--days <n>` | Lists only Sessions whose last activity falls within the last n calendar days. Today counts as day 1, so `--days 2` covers yesterday and today, as `cost --days` does. Combines with `-a` and `--json`. | — |
| `--json` / `--server <url>` | See [Global conventions](#global-conventions). | — |

```bash
penguin ls
penguin ls --agent-id default_agent -a
penguin ls --json
```

## penguin input

Sends a message into a Session or, without `-m`, polls its last answer. The session id is optional. When you omit it, the command uses the agent's most recent Session (see [Global conventions](#global-conventions)), so bare `penguin input` answers "what did my agent last say".

```bash
penguin input [session_id] [options]
```

| Option | Description | Default |
| --- | --- | --- |
| `-m, --message <text>` | The message text. Omit it to poll the last assistant reply instead. | — |
| `--timeout <duration>` | Soft-yield wait budget. With `-m`, the command detaches at expiry as `run` does, and `--timeout 0` returns right after delivery. Without `-m`, the command takes the snapshot at expiry (`0` means immediately) and notes that the Session is still running. | Wait indefinitely |
| `--project-id <id>` | Scope of the fragment search. A full session id needs none. | `PENGUIN_PROJECT_ID`, else `default_project` |
| `--agent-id <id>` | The agent whose most recent Session an omitted session id means. | `PENGUIN_AGENT_ID`, else `default_agent` |
| `--json` / `--server <url>` | See [Global conventions](#global-conventions) and the JSON shapes below. | — |

With `-m`, a running Session receives the text as steering, delivered between turns, and an idle Session starts a new Task. By default the command waits and renders until the turn completes.

Without `-m`, the command is a poll that mirrors `input_subagent`'s empty-prompt semantics. It prints the Session's most recent complete assistant text, an idempotent snapshot of the last answer taken from the end of the history. Thinking and tool output are skipped, and nothing is queued or steered. If the Session is running, the command first waits silently, up to `--timeout` when given (`--timeout 0` takes the snapshot immediately). If the Session is still running at expiry, the command prints the latest text with the still-running note and exits 0.

Under `--json`:

- With `-m`, the command prints `{sessionId, status, text}`, where `status` is `completed`, `aborted` or `running`. The `--timeout 0` shape has no `text`.
- The poll form prints `{sessionId, status, text}`, where `status` is `idle` or `running`, and `text` is `""` when there is no reply yet.

```bash
penguin input 402a2e24 -m "also check the tests"
penguin input 402a2e24 -m "queue this" --timeout 0    # deliver and return immediately
penguin input 402a2e24                    # poll: print the last assistant reply
penguin input                             # poll the agent's most recent session
penguin input 402a2e24 --timeout 5m       # poll, waiting out a running turn up to 5 minutes
```

## penguin logs

Renders a Session's history with the same renderer the REPL uses. The session id is optional. When you omit it, the command uses the agent's most recent Session (see [Global conventions](#global-conventions)), so bare `penguin logs` shows what just happened.

```bash
penguin logs [session_id] [options]
```

| Option | Description | Default |
| --- | --- | --- |
| `--tail <n>` | Shows only the last n entries. | All entries |
| `-f, --follow` | Keeps following the live stream after the history. Read-only: Ctrl-C detaches without touching the Session. | — |
| `--timeout <duration>` | Stops following after this long (soft yield, exit 0). Only meaningful with `-f`. | — |
| `--project-id <id>` | Scope of the fragment search. | `PENGUIN_PROJECT_ID`, else `default_project` |
| `--agent-id <id>` | The agent whose most recent Session an omitted session id means. | `PENGUIN_AGENT_ID`, else `default_agent` |
| `--json` / `--server <url>` | `--json` prints the raw message array, and with `-f` one JSON message per line as messages arrive. | — |

```bash
penguin logs                    # the agent's most recent session
penguin logs 402a2e24 --tail 20
penguin logs 402a2e24 -f
```

## penguin agent

`agent ls` lists the Project's agents with their id, name, session count and description. `agent create` creates an agent.

```bash
penguin agent ls [--project-id <id>] [--json] [--server <url>]
penguin agent create --agent-id <id> [options]
```

Options of `agent create`:

| Option | Description | Default |
| --- | --- | --- |
| `--agent-id <id>` | The agent id, which is also its directory name. Required. | — |
| `--name <name>` / `--description <text>` | Display name and description. | — |
| `--plugins <names>` | Comma-separated library plugin names to preinstall, each with its Skills and hook package. Unknown names are rejected before anything is created. | — |
| `--project-id <id>` / `--json` / `--server <url>` | See [Global conventions](#global-conventions). | — |

```bash
penguin agent ls
penguin agent create --agent-id helper --name "Helper" --plugins software-development,goal
```

## penguin project

`penguin project ls` lists the Projects this account can reach, its own and shared ones, with their id, display name and role. It takes `--json` and `--server`.

```bash
penguin project ls
```

## penguin cost

Shows Token usage and cost from the server's usage aggregates. By default the command prints a summary card with today, the last 7 days and the total, which ignore any range options. `--by` prints a grouped table instead.

```bash
penguin cost [options]
```

| Option | Description | Default |
| --- | --- | --- |
| `--days <n>` | Covers the last n days by setting the from and to dates. | — |
| `--from <date>` / `--to <date>` | Explicit range in `yyyy-mm-dd`, always given as a pair. | — |
| `--by <dimension>` | Groups by `date`, `agent`, `model` or `session`. | Summary card |
| `--project-id <id>` / `--agent-id <id>` | Scope. `--agent-id` filters, and there is no default agent: costs cover the whole Project unless you narrow them. | Project: see [Global conventions](#global-conventions) |
| `--json` / `--server <url>` | See [Global conventions](#global-conventions). | — |

A `+` after a cost marks a partial sum: some model in that bucket has no pricing configured. `-` means there is no priced usage at all.

```bash
penguin cost
penguin cost --days 7 --by model
penguin cost --from 2026-08-01 --to 2026-08-25 --by agent
```

## penguin schedule

Lists and manages the Project's scheduled tasks.

```bash
penguin schedule ls [--project-id <id>] [--agent-id <id>] [--json] [--server <url>]
penguin schedule add <name> --prompt <text> --start-at <ISO|now> [options]
penguin schedule update <name> [options]
penguin schedule rm <name> [--project-id <id>] [--agent-id <id>] [--json] [--server <url>]
```

`penguin schedule ls` lists the scheduled tasks of all agents, or of one with `--agent-id`. Columns: agent, name, enabled, start time, period (`once` for one-shot tasks), target (a bound Session's short id, or `new session`), last fired, and a status marker for every state other than active (`expired`, `done`, `missed` or `invalid`). Schedule files that cannot be parsed are listed too, marked `invalid`.

`add`, `update` and `rm` go through the API, which writes the schedule's TOML file. The file stays the single source of truth, and the CLI acts as a validated writer, the same pattern model config and the vault follow: updates go through the system interface, validation happens at the interface layer, and hand edits stay possible. API errors are printed verbatim, so an agent gets validation right away instead of waiting for the reconcile pass that a hand edit goes through.

Options of `add` and `update`:

| Option | Description | Default |
| --- | --- | --- |
| `--prompt <text>` | The text each firing sends. Required on `add`. | — |
| `--start-at <ISO\|now>` | First fire time, in ISO 8601 or the literal `now` for the current instant. Required on `add`. | — |
| `--period <duration>` | Fixed interval, at least `5m` (for example `30m`, `12h`, `1d`, `7d`). | One-shot |
| `--end-at <ISO>` | Stops firing after this instant. | — |
| `--session-id <id>` | Binds firings to one Session. Use either this or the new-session options, not both. | — |
| `--workspace <path>` / `--model-id <id> --provider <group>` | New-session mode: each firing creates a Session on this Workspace and model. The model pair is both-or-neither. | A temporary Workspace; the Project's default model |
| `--disabled` (`add`) | Creates the task disabled. | Enabled |
| `--enable` / `--disable` (`update`) | Turns the task on or off. | — |
| `--project-id <id>` / `--agent-id <id>` / `--json` / `--server <url>` | See [Global conventions](#global-conventions). | — |

- `add` creates the task enabled, because adding a task means you want it to run; `--disabled` opts out. This is a deliberate difference from the raw file, whose `enabled = false` default stays for hand edits.
- `update` reads the stored task, changes it and writes it back, so fields you do not specify keep their values. Switching between the bound-Session and new-session targets clears the other target's fields.
- `rm` deletes without asking. The server still requires the Project owner.

```bash
penguin schedule add daily-report --prompt "summarize the day" --start-at 2026-09-01T09:00:00Z --period 1d
penguin schedule add once-now --prompt "check the deploy" --start-at now --session-id 402a2e24
penguin schedule update daily-report --period 12h --disable
penguin schedule rm daily-report
```

## penguin org

Company mode's command family, a thin client over the organization API. An organization's files under the Project directory (the employee tree, the desks ledger, the calendar, tickets and channels) stay the single source of truth. Every subcommand either reads a projection of those files or writes through the route that edits them, under the same validated-writer contract `schedule` follows: API errors are printed verbatim, so an agent gets validation right away instead of waiting for the reconcile pass a hand edit goes through. By convention, generated ids carry a prefix, `co_` for an organization and `ch_` for a channel. The server proposes these prefixes but never enforces them, so an id passed here is created exactly as typed.

```bash
penguin org ls [--project-id <id>] [--json]
penguin org create --org-id <id> --mission <s> [--name <s>] [--language <zh|en>] [--workspace <path>] [--ceo-budget <usd>] [--model-id <id> --provider <p>] [--project-id <id>]   # by convention `co_<slug>`
penguin org show [--org-id <id>] [--json]                       # overview: working language, employees and states, board counts, spend against budget, pending items
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
penguin org ticket create --title <s> (--goal <s> [--criteria <s>] | --body-file <path>) [--owner <principal>] [--slug <words>] [--parent <ticket_id>] [--notify <p,p>] [--priority P0|P1|P2] [--due <date>]
penguin org ticket move <ticket_id> --to <col> [--reason <s>]   # moving into rejected needs a reason
penguin org ticket assign <ticket_id> --owner <principal>
penguin org ticket block <ticket_id> --reason <s> [--by <principal|ticket_id>]   # the ticket stays in its column
penguin org ticket unblock <ticket_id>
penguin org ticket progress <ticket_id> -m <text>               # a progress entry, attributed to the calling session
penguin org ticket start <ticket_id> [-m <note>] [--workspace <path>] [--agent-id <id>] [--json]   # a ticket session working on the ticket in the background; prints its id
penguin org ticket attach <ticket_id> [--session <session_id>]   # an existing session as a contributor (default: the calling session)
penguin org channel ls [--json]                                 # every channel for a person, its own for an employee
penguin org channel create <channel_id> [--name <s>] [--purpose <s>]   # a new channel holds only its creator; `ch_<slug>` by convention
penguin org channel show <channel_id> [--json]                  # purpose, member count and the member list
penguin org channel invite <channel_id> <principal>...          # any member invites; one POST per principal
penguin org channel join <channel_id>                           # people only; an employee waits to be invited
penguin org channel leave <channel_id>                          # self-removal
penguin org channel remove <channel_id> <principal>             # people only
penguin org channel archive <channel_id> | unarchive <channel_id>      # people only; read-only while archived
penguin org channel tail [--channel <id>] [--date <d>] [-n <count>] [--json]
penguin org channel send -m <text> [--channel <id>] [--ref-ticket <id>] [--ref-session <id>]
penguin org handbook list [--json]
penguin org handbook show [path] [--json]
penguin org handbook write <path> (-m <text> | --file <file>)
penguin org handbook rm <path>
penguin org finance [--period <YYYY-MM>] [--json]
```

### Common options

Every subcommand takes `--org-id <id>`, `--project-id`, `--json` and `--server`.

`--org-id` defaults to `PENGUIN_ORG_ID`, the one variable company mode adds to the environment described under [Server connection](#server-connection). The server injects it into every tool subprocess of a desk or ticket session, so an employee's own `penguin org` calls reach its organization without naming it, while a person in a shell passes the flag. There is no default organization: with neither the flag nor the variable, the command fails before contacting any server. `create` is the exception, because its `--org-id` is the id to create and never comes from the environment.

`--json` prints the response as one line of JSON. Without it, the write commands print a one-line confirmation.

### Caller identity in a session

Inside a session, the same environment identifies the caller:

- `--agent-id` on the `calendar` commands and the `<agent_id>` argument of `desk` default to `PENGUIN_AGENT_ID`, so an employee schedules its own events and renews its own desk. `calendar ls` without the flag lists every employee's events.
- `ticket start` runs the ticket session as `--agent-id` when given, else as `PENGUIN_AGENT_ID` when it is set, else as the ticket's owner, whom the server picks. The command also sends `PENGUIN_SESSION_ID`, which lets the server enforce its rule: only the ticket's owner, or a person, starts the ticket's sessions. An employee that asks for someone else's ticket, or for a ticket with no employee owner, gets `403 not_ticket_owner`, printed verbatim. The error tells it to assign the ticket instead (`penguin org ticket assign <id> --owner agent:<employee>`) and let that employee's desk pick it up in its next sweep. The owner uses `--agent-id` to bring a colleague onto its own ticket.
- The ticket writes (`create`, `assign`, `move`, `block`, `unblock`, `progress`) and the channel writes (`create`, `invite`, `join`, `archive`, `unarchive`, `send`) send `PENGUIN_SESSION_ID` in their request body, so the file records the session's employee rather than the token's user. `ticket attach` attaches that session when `--session` is omitted; `--session` takes a full id or a unique fragment, as everywhere.
- The channel reads (`ls`, `show`, `tail`) and the member DELETE behind `leave` and `remove` have no request body, so they send the same session as `?sessionId=`. Without it, the server would answer an employee as the signed-in person, and `channel ls` would list every channel instead of the employee's own.

### ls, show and chart

- `ls` lists the Project's organizations with their employee, ticket and spend counts.
- `show` prints one organization's overview: name, mission, status and working language, employees by state, tickets per column, and the period's spend against the CEO's budget. It also lists what waits for you: mentions, tickets to review, and tickets blocked on you.
- `chart` prints the reporting tree, indented by level, with each employee's title, live state, own and cumulative spend, and budget.

An organization or employee that fails validation is listed with `invalid: <reason>` rather than hidden.

### create

`--ceo-budget` is the CEO's monthly budget in USD and defaults to 100. Budgets are compared along the cumulative line, the employee plus every subordinate, so the CEO's budget covers the whole company. A new organization is therefore capped rather than unbounded, and the trigger block of the initialization run names the number so the CEO can size its hiring proposal to it. `0` is a real budget of zero. To remove the cap again, send `PATCH .../employees/<org_id>_ceo` with `budget: null`, as the Web App's employee editor does.

`--language zh|en` sets the organization's working language. Without it, the mission decides: one Han character anywhere in it makes the language `zh`. Everything the organization writes follows this language: its handbook, the employee briefs, the CEO's initialization run and the desk session titles.

### hire

`hire` takes exactly one of `--agent-id`, which hires an existing agent, and `--new-agent`, which creates one. For a new agent, `--name`, `--description` and `--skills` describe it; `--skills` lists extra library plugins, added on top of `agent-company,agent-development`, which every employee needs.

`--workspace` is a subdirectory of the organization's shared workspace (`.` for all of it) or an absolute path. It is never resolved against the CLI's working directory. It defaults to a subdirectory named after the employee, because the shared root holds the shared inputs and is nobody's desk.

- A relative subdirectory is normalized, so `./hr`, `hr/` and `hr` are the same partition. The server creates it when it records the hire, so `--workspace hr` is enough and nothing has to exist first.
- An absolute path names one of the user's own directories and must already exist.
- A path that climbs out of the shared workspace with `..` is refused with 400 `invalid_workspace`.

A desk or ticket session also creates its directory when it opens. `--budget` is the monthly budget in USD for the employee plus everyone below it.

### employee set

`employee set` changes only the fields you give. `--workspace` works as it does for `hire` but has no default: the partition changes only when you pass the flag. `--budget` is the monthly budget in USD for the employee plus everyone below it. The model pair is both-or-neither, as everywhere.

### calendar

`calendar` uses the same writer as `penguin schedule`: `add` creates an enabled event unless you pass `--disabled`, `--start-at now` means the current instant, `update` reads the stored event, changes it and writes it back, and `rm` deletes without asking. Events fire into the employee's desk session, and only while both the organization and the employee are active; otherwise the status column shows `paused`.

`add` and `update` answer with the event plus any rota advice the write triggered: another employee's recurring event on the same start minute, a second recurring event for the same employee with the same period, or a recurring event that starts at `now`. The CLI prints each piece of advice on its own line as `Rota notice: …`. The advice never blocks the write, and the lines stay in the server's English.

### ticket

- `ls` fetches the whole board and filters it locally. `--status` takes a column: `proposed`, `in_progress`, `review`, `done` or `rejected`. Under `--json`, `ls` prints the filtered list as `{ tickets, invalidFiles }`.
- `show` prints the derived figures first (column, running state, cost and rolled-up cost, contributing sessions, child tickets), then the ticket's own fields, its prose sections, and its operation history under `History:`.
- `create` takes either `--goal` (with `--criteria`) or the whole Markdown body from `--body-file`. The frontmatter is generated either way.
- `start` prints the bare session id, as `run --background` does, for `penguin logs` and `penguin input` to pick up.
- `--owner <principal>` names the one principal responsible: an employee (an agent id or `agent:<id>`) or a Project member (`user:<id>`). It defaults to the caller. When no `--notify` is given, the owner becomes the whole `notify` list, but only if the owner is an employee: a person is not notified about a ticket they own, and adds themselves with `--notify` to be told.
- Who filed a ticket is not a flag. It is the `created` entry of the ticket's history, taken from the environment the command ran in.
- A ticket id is `<yyyy-mm-dd>-<slug>`, where the slug is lowercase English words joined by hyphens. `--slug <words>` sets it. A title with too little English in it needs this flag when the server cannot have the Project's model name it (400 `slug_required`).
- A write that claims work also records the calling session as one of the ticket's contributing sessions, so its cost is added to the ticket. These writes are `progress`, an edit of the body, and `move --to review`. Moving into any other column, `block` and `unblock` record nothing.
- `progress -m` takes one plain sentence saying what was done and where; the server records who wrote it and when.
- `--goal`, `--criteria` and `progress -m` ask for every input, deliverable and file to be named by its full path.

### channel

`--channel` defaults to `default_channel`, the all-hands channel that every employee and Project member is in. `ls` lists it first, under its localized label rather than its stored name.

A new channel holds only its creator. An employee gets in when a member invites it; a person may `join` any channel and can read all of them. `join` and `leave` always act on the caller's own principal (the session's employee inside a desk or ticket session, the signed-in person outside one), so joining can never add someone else. `join`, `remove`, `archive` and `unarchive` are actions for people: inside a session the server answers them with `403 not_a_member`, which is printed verbatim like every other API error.

`tail` prints the day's last 20 messages as `time  sender  text`; `-n` changes the count and `--date` picks another day. Under `--json` it prints the day's response with those messages. `send` posts one message, and `@agent:<id>` and `@all` mentions trigger the mentioned employees' desks. A `system` line carries a structured `notice` beside its English text, so `tail` renders it in the CLI's own language; a notice kind this build does not know keeps the English text.

### handbook

- `list` lists the handbook's files with their path, size and last update, the index first.
- `show` prints one document, or the index (`README.md`) when no path is given.
- `write` stores a document from exactly one of `-m <text>` and `--file <file>`.
- `rm` deletes a document. The index cannot be deleted.

Paths that contain `..` segments are refused.

### finance

`finance` prints the period's spend per employee (own and cumulative along the reporting line, against the budget, with `warned` and `paused` marks) and per ticket, then the total. When some usage ran on a model without pricing, a note on stderr says the figures are a lower bound.

## Approval modes (--approve)

| Mode | Behavior |
| --- | --- |
| `allow-all` | Approves every tool call automatically (the default) |
| `deny-all` | Rejects every tool call automatically |
| `read-only` | Approves read-only tools automatically and asks about the rest |
| `always-ask` | Asks about every tool call |

At an approval prompt, `n` or `no` denies the call. `y`, `yes` or any other answer, including a bare Enter, approves it.

## penguin config

Manages a Project's model configuration, per-agent vault environment variables and the UI language. Every subcommand except `lang` takes `--project-id <id>` (default: the default Project) and `--root <dir>`.

### model add

Adds or updates a model entry.

```bash
penguin config model add --provider deepseek --model-id deepseek-v4-pro --api-key sk-... --set-default
```

| Option | Description | Default |
| --- | --- | --- |
| `--model-id <id>` | The upstream model id. Required. | — |
| `--provider <group>` | The provider group the entry belongs to. Required. | — |
| `--api-key <key>` | API key, stored inline in the Project's hidden `.project_config.toml`. | — |
| `--base-url <url>` | Custom endpoint base URL. | See below |
| `--context-window <n>` | Context window size, in tokens. | — |
| `--max-tokens <n>` | Maximum output tokens for this model, a positive integer. When set, it overrides the agent's `model.max_tokens`; lower it for small-context models. | The agent's `model.max_tokens` |
| `--client-type <type>` | AgentHub client protocol type, such as `openai-chat`. | See below |
| `--vision` / `--no-vision` | Marks image input as supported or unsupported. | Keeps the current value |
| `--fast-mode` / `--no-fast-mode` | Turns fast mode (faster output at premium pricing) on or off. | Off; omitting both keeps the current value |
| `--price-cache-read <n>` | Cache-read price, in USD per million tokens. | — |
| `--price-cache-write <n>` | Cache-write price, in USD per million tokens. | — |
| `--price-output <n>` | Output price, in USD per million tokens. | — |
| `--set-default` | Also sets the entry as the Project's default model. | — |

- The CLI never derives `--provider` from the model id. Gateways resell vendor models under their upstream ids, so a guessed group could write the credential onto another vendor's endpoint. Use `custom` for any endpoint outside the built-in groups.
- For a new entry, `--client-type` and `--base-url` default to what the built-in catalog sets for that exact `(provider, model_id)` pair. Without a catalog row, the group decides: a group that pins a protocol uses it; `custom`, user-defined and gateway groups get `openai-chat`, with a gateway's endpoint filled in as the base URL; and first-party vendor groups leave both unset. Updating an existing entry changes them only when you pass the flags.
- Turning on `--fast-mode` for a model whose AgentHub client rejects the parameter still writes the entry, but prints a warning on stderr.

### model default / model vision / model list / model remove

```bash
penguin config model default --model-id <id> --provider <group>
penguin config model vision --model-id <id> --provider <group>
penguin config model list
penguin config model remove --model-id <id> --provider <group>
```

- `model default` sets the Project's default model, and `model vision` sets the vision proxy model. Both require `--model-id` and `--provider`, and the pair must already be in the model list.
- `model list` lists the configured models and marks the default model with `*`.
- `model remove` deletes a model entry together with the credential stored inline on it. It requires `--model-id` and `--provider` and matches the pair exactly, so the same upstream id under another group is left alone. It exits non-zero when the pair is not in the config. If the removed entry was the default model or the vision model, that setting is cleared, because a setting that names a model no longer configured would make the next session fail outright.

### vault

A per-agent store of environment variables, written to `agent_state/.vault.toml`. The values are injected only into the environments of tool subprocesses, never into the model context.

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

`--agent-id` defaults to `default_agent`.

### lang

```bash
penguin config lang en
```

Sets the CLI's interface language (`en` or `zh`) by writing `PENGUIN_LANG` into your shell's startup file. In an interactive terminal the command then offers to open a new shell so the setting takes effect; otherwise it prints how to apply it. On Windows the command is refused, because there is no POSIX shell startup file to write.

## penguin server / penguin web

Two entry points into the same service process. `server` runs it headless. `web` also waits until the service is ready, prints its URL and opens the browser.

```bash
penguin server [--port <port>] [--host <host>]
penguin web [--port <port>] [--host <host>] [--no-open]
```

| Option | Description | Default |
| --- | --- | --- |
| `--port <port>` | Listen port. | `7364` |
| `--host <host>` | Listen host. | `127.0.0.1` |
| `--no-open` | `web` only: does not open the browser. | — |

Port and host are resolved in this order: the command-line option, then the `PORT` / `HOST` environment variables (including those from `.env`), then the defaults.

If a server is already running on this data root, `penguin server` says so and exits 1, while `penguin web` prints the running instance's URL and opens it (unless `--no-open`) instead of starting a second one.

Both commands run the service as a child process and stay in front of it as its supervisor. Ctrl+C in the terminal reaches the service, and the command exits with the service's exit code. When the service asks to be restarted, as the Web App's **Restart and update** does after `penguin update` has replaced the install, the supervisor starts it again on the new release and prints a line saying so. A development run through `tsx` cannot be relaunched by plain Node, so it runs the service in-process instead, and the Web App then tells the admin to restart by hand.

```bash
penguin web
```

### penguin server status

Prints the server state of this data root and the machine's own id, as one line of JSON. It answers whether or not a server is running, because it reads the data root rather than asking a live process.

```bash
penguin server status [--root <dir>]
# {"running":true,"port":7364,"pid":41233,"machineId":"LNrJdHAZJ91G58i0"}
```

`running` is true only when the recorded pid is alive and its port accepts a connection, so a recycled pid does not look like a live server. `port` and `pid` are `null` when no server is running. `machineId` is `null` until a server has started on this machine at least once: the id is minted on first boot and never changes afterwards. The data root comes from `--root` or `PENGUIN_HOME` as usual.

The **Machines** page runs this command over ssh to ask a machine what it is doing, which is why the output is JSON rather than prose.

### penguin server reset-admin-password

An offline rescue for a forgotten Web admin password. Run it with the server stopped; it refuses while a server is running on the data root.

```bash
penguin server reset-admin-password
```

The built-in `admin` returns to the unclaimed state: its password becomes a random one nobody has seen, and all of its sessions are revoked. Start the server again and open the first-login link it prints to set a new password; nothing needs to be written down in between. The admin resets other accounts on the **Users** page, and this command only touches `admin`. The data root comes from `PENGUIN_HOME` as usual.

### penguin server stop

Stops the server on this data root and reports the outcome as one line of JSON.

```bash
penguin server stop [--root <dir>]
# {"ok":true,"pid":41233}
```

The command sends `SIGTERM` and waits up to 15 seconds for the server to let go of the data root. It never sends `SIGKILL`: the server holds a database and may be finishing a task, and destroying that on a timeout is not a caller's decision to make. A root with no server running answers `{"ok":true}`, because nothing serving the root is the outcome the caller asked for.

When the server cannot be stopped, the command prints `{"ok":false,"pid":…,"detail":"…"}` and exits 1. That happens when the signal cannot be delivered, when the server still holds the data root 15 seconds after `SIGTERM`, and on Windows, where a graceful stop cannot be signalled; stop the server from its own console there.

The **Machines** page runs this command over ssh when it restarts a machine. It is a command rather than a request to the server because the machine that needs stopping is usually the one whose platform is out of date, and a platform route exists only once the machine already runs the build that has it.

## penguin version

Reports which build is running. The version number alone cannot answer that, because every build made from a checkout between two releases also calls itself `0.2.3`, so a release and a source build identify themselves differently.

```bash
penguin version          # v0.2.3            (a release)
penguin version          # v0.2.3-14-g9e8f7d6-dirty   (built from a checkout)
penguin version --json   # the full build info
```

| Option | Description | Default |
| --- | --- | --- |
| `--json` | Prints the full version report instead of one line: `{version, describe, channel, buildDate, commit, branch, dirty, runtime, harness}`. | — |
| `--root <dir>` | The data root whose HMR store is reported as `harness`. Only used with `--json`. | `PENGUIN_HOME`, else `~/.penguin/data` |

The bare form prints one line. For a source build, that line is the output of `git describe --tags --dirty`: `v0.2.3-14-g9e8f7d6-dirty` means fourteen commits after `v0.2.3`, at commit `9e8f7d6`, with uncommitted changes. `-v, --version` prints the same line.

`describe` names the nearest reachable git tag, which is not always `v` followed by `version`. Release preparation bumps `version` in its own commit and creates the tag afterwards, so a build from that window reports `v0.2.3-14-g9e8f7d6` while `version` already reads `0.2.4`. Read `version` for the release number and `describe` for the position in history.

The JSON is the same record that `GET /api/version` returns, so a bug report can collect it from either side of the HTTP boundary. In it:

- `channel` is `release` or `source`.
- `buildDate` and `commit` are stamped into the build by the release workflow, and are null for a source build.
- `branch` and `dirty` describe a source build's git position, and are null for a release, where they do not apply: the release workflow stamps its constants into the tree before building.

### harness: what was hot-pushed here

`harness` describes the data root's HMR store: the harness code a hot update committed, which a restart resumes. It is null when nothing was ever pushed to that root.

```json
"harness": {
  "source": { "repo": "…/penguin-harness", "revision": "v0.2.3-7-gabc1234-dirty" },
  "pushedAt": "2026-08-20T10:15:00.000Z",
  "bundles": { "platform": "store/platform/…", "cli": "store/cli/…", "web": "store/web/…" }
}
```

This is the one thing the version line cannot report. A pushed bundle lands outside any checkout, so it can only identify itself by the version it was compiled from. `source.revision`, recorded by the pusher and written the same way as `describe`, is the only field that names the revision behind it. `bundles` holds the content-addressed pointers of the committed artifacts, which identify the pushed code itself whatever the pusher claimed about it.

`harness` describes the store, not the running process. `penguin` runs the packaged CLI while `penguin-hmr` runs the store's, so a non-null `harness` does not mean the command that printed it is the pushed code. `source` is null for a version pushed by a client that recorded no provenance, including anything pushed before provenance was recorded at all.

An installed `penguin` never runs git: it reads constants stamped into the build. A release gets them from the release workflow. Every other build gets its git position inlined by the bundler that produced it, so an artifact still identifies itself after it leaves its checkout: a hot-pushed bundle under `<root>/hmr/store/` reports the revision it was built at, even on a machine with no checkout and no git installed. Asking git at run time is only the fallback for an unbundled `tsx` run, and even then it asks about its own checkout, so `penguin version` run inside an unrelated repository reports the harness's revision, not that repository's.

## penguin auth

Signs in to a running PenguinHarness server from the terminal. There are two ways in, and the right one depends on where you are.

```bash
penguin auth login                      # password, against the server on this data root
penguin auth login --server https://penguin.example --user-id alice
penguin auth status
penguin auth logout
penguin auth token                      # no password: minted from this data root
```

Every `auth` subcommand takes `--root <dir>` to pick the data root; see [Global conventions](#global-conventions).

### penguin auth login

`login` takes a password and asks a running server for a session, exactly as the browser's login page does. The target defaults to the server running on this data root, read from its lock file, so signing in to your own server needs no URL.

When run interactively, `login` asks for the account first and then the password, and the password prompt names the account, so you never type one account's password for another. If you supply the password non-interactively (`--password` or `PENGUIN_PASSWORD`), neither question is asked, because a script cannot answer them.

| Option | Description | Default |
| --- | --- | --- |
| `--server <url>` | The server to sign in to. | The server running on this data root |
| `--user-id <id>` | The account. Asked for when omitted; a bare Enter means `admin`. | `admin` |
| `--password <pw>` | The password. Also read from `PENGUIN_PASSWORD`; otherwise prompted for without echo. | — |
| `--print` | Also prints the session token to stdout, for piping. | — |

> [!WARNING]
> Prefer `PENGUIN_PASSWORD` or the prompt over `--password`: anyone on the machine can read a command line through `ps`.

### penguin auth token

`token` takes no password at all. It writes a session row straight into the data root's `web.db`, and what authorizes it is that you can read and write that root, which already holds every credential the token could reach. That makes `token` the tool of the **data root owner**: on a multi-user deployment the root belongs to the OS account that runs the server, and everyone else signs in with `auth login`. It fails when no server has ever run on the data root, since there is no `web.db` to write to yet. Use it where there is no password to give:

- A machine whose admin password someone set by hand.
- A script that must not hold a password.
- A controller reaching a managed machine over ssh.

| Option | Description | Default |
| --- | --- | --- |
| `--user-id <id>` | The account. | `admin` |
| `--ttl-seconds <n>` | The session's lifetime in seconds: a positive integer, capped at 30 days. | `3600` |
| `--mark` | Prints a fixed marker line before the token, for a caller that parses the token out of a shell whose login profile may print a banner. | — |

### penguin auth status / penguin auth logout

The session is stored in `<root>/cli-session.json` with mode 0600. `login` writes it, and so does `token` when a server is running on the data root. `status` reads it. `logout` revokes the session and deletes the file: it tells the server first, so the session ends on the server rather than merely being forgotten locally. If the server cannot be reached, `logout` says so and deletes the local file anyway.

## penguin update

Upgrades this install in place, using the mechanism it was installed with. The command detects the install kind from the real path of the running CLI and never guesses.

```bash
penguin update --check     # report versions only
penguin update             # upgrade to the latest release, after confirming
```

| Option | Description | Default |
| --- | --- | --- |
| `--check` | Only reports the installed and latest versions, and changes nothing. Exits 0 either way. | — |
| `--release <tag>` | Targets a specific release instead of the latest (`v0.1.2` or `0.1.2`). Older tags are allowed and reported as a downgrade. | The latest release |
| `-y, --yes` | Skips the confirmation prompt. | — |

The flag is `--release`, not `--version`, because `-v, --version` is the CLI's own version flag and would take precedence.

| Install kind | How it upgrades |
| --- | --- |
| Tarball (`install.sh`, default `~/.penguin`) | Re-runs the official installer, keeping the install directory and whether the package bundles a Node runtime |
| Global npm, pnpm, yarn or bun install | Runs that package manager's global install of `@prismshadow/penguin-cli@<target>`. If the manager cannot be identified, prints the command instead of guessing |
| Source checkout | Refused: update it with `git pull` and a rebuild |
| The desktop app's bundled CLI | Refused: it is replaced when the app updates, so check for updates from the app menu |
| Unrecognized layout | Refused: reinstall with the official installer, or upgrade with the package manager you used |

Without `-y`, the command prints exactly what it will do (the mechanism, the target version and the install directory) and asks for confirmation. When stdin is not a terminal, it requires `--yes` instead of waiting on a prompt nobody can answer. **The data root is never touched**: an upgrade replaces only `bin`, `lib`, `web` and `node`. On Windows neither upgrade path runs in place. The installer is a POSIX shell script, and a global install cannot be driven from here because Node does not execute an `npm` or `pnpm` `.cmd` shim without a shell, so the command prints the exact command for you to run yourself.

Release discovery and downloads follow `PENGUIN_DOWNLOAD_SOURCE=auto|oss|github`, the same policy as the stable installer entry point:

- `auto`, the default, reads the OSS `latest.json`, prefers that immutable release, and falls back to the matching GitHub tag. The package itself then comes from whichever source the installer's speed probe picks.
- `oss` and `github` are strict: the command uses only that source.
- `--release <tag>` skips latest-version discovery but still follows the selected source policy.
- An explicit HTTPS `PENGUIN_DOWNLOAD_BASE_URL` takes precedence over everything for the installer and package downloads, and `PENGUIN_DOWNLOAD_FALLBACK_BASE_URL` optionally adds a fallback for the package.

See also: [Configuration Reference](/configuration), [Models & Providers](/models).
