---
title: CLI Reference
description: Complete reference for the penguin command, its subcommands, and options.
---

The CLI ships as the npm package `@prismshadow/penguin-cli`; the command is `penguin`. Running bare `penguin` prints help; `-v, --version` prints the running build's one-line identity, and `penguin version --json` prints the whole of it. A `.env` file in the working directory is loaded automatically on startup.

The CLI is a thin client of the server: every session-facing command (`run`, `chat`, `ls`, `input`, `logs`, `agent`, `project`, `cost`, `schedule`) sends HTTP requests to a PenguinHarness server and renders the replies — tasks execute on the server, sessions live in its index, and the Web App sees everything the CLI creates (and vice versa). Only `config` still edits the Project's files directly, and `server` / `web` start the service itself.

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
- `--json` prints raw JSON instead of the rendered/tabular output; `--server <url>` targets a specific server (see above).
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
| `--thinking <level>` | Thinking level for this task: `low` / `medium` / `high` / `xhigh` / `max`; rides the task request. Omitted, the session's pinned level (else the Agent config) applies |
| `--session <sessionId>` | Reuse an existing session (full id or unique fragment) instead of creating one; excludes `--workspace` and the model pair |
| `--background` | POST the task and exit immediately, printing the session id (`{"sessionId"}` under `--json`); the task keeps running on the server — follow it with `penguin logs -f` |
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

With `--resume`, the Workspace and model are locked by the original Session and cannot be overridden via `--workspace` / `--model-id` / `--provider`. The thinking level is a per-turn parameter, so `--thinking` is still accepted: it becomes the initial `/thinking` override instead of a creation-time default. On exit, a copy-pastable `penguin chat --resume <sessionId>` command is printed.

In-REPL commands:

| Input | Behavior |
| --- | --- |
| any text while a Task runs | Mid-run steering: queued and delivered to the model between turns as a `[user_steering]` user message (a `»` acknowledgment echoes the text); rendering is held while you type so streamed output doesn't scribble over the line. If the Task finishes first, the line is sent as the next normal prompt |
| `/compact` | Proactively compact the current context |
| `/clear` | Start a fresh blank Session in place; the old Session stays on disk and can be resumed with `--resume` |
| `/thinking` | Show the thinking level the next turn will run at, and whether it is this Session's default or an active per-turn override (which also names the default it overrides) |
| `/thinking <level>` | Override the thinking level (`low` / `medium` / `high` / `xhigh` / `max`) for subsequent turns of this chat; never written back to the Agent config. The override applies to this Session's own turns only — subagent sessions are spawned with the level the Session was created with |
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
| `--json` / `--server <url>` | As everywhere |

## penguin input

Send a message into an existing session. A running session receives it as steering (delivered between turns); an idle one gets a new task. By default the command waits and renders until the turn completes; `--no-wait` returns right after the server accepts it.

```bash
penguin input 402a2e24 -m "also check the tests"
penguin input 402a2e24 -m "queue this" --no-wait
```

| Option | Description |
| --- | --- |
| `-m, --message <text>` | Required; the message text |
| `--no-wait` | Return after the 202 instead of rendering the turn |
| `--project-id <id>` | Fragment-search scope (a full session id needs none) |
| `--json` / `--server <url>` | As everywhere; `--json` with waiting prints `{sessionId, status, text}`, with `--no-wait` just `{sessionId}` |

## penguin logs

Render a session's history through the same renderer the REPL uses.

```bash
penguin logs 402a2e24 --tail 20
penguin logs 402a2e24 -f
```

| Option | Description |
| --- | --- |
| `--tail <n>` | Show only the last n entries |
| `-f, --follow` | Keep following the live stream after the history (read-only; Ctrl-C detaches without touching the session) |
| `--project-id <id>` | Fragment-search scope |
| `--json` / `--server <url>` | As everywhere; `--json` prints the raw message array (and, with `-f`, one JSON message per line as they arrive) |

## penguin agent

```bash
penguin agent ls
penguin agent create --agent-id helper --name "Helper" --skills web-search,pdf
```

`agent ls` lists the project's agents (id, name, session count, description). `agent create` creates one:

| Option | Description |
| --- | --- |
| `--agent-id <id>` | Required; the agent id (directory name) |
| `--name <s>` / `--description <s>` | Display name and description |
| `--skills <a,b>` | Comma-separated library skill names to preinstall; unknown names are rejected before anything is created |
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

### penguin server reset-admin-password

Offline rescue when the Web admin password is forgotten. Run it with the server stopped — it refuses while one is running on the data root:

```bash
penguin server reset-admin-password
```

The built-in `admin` gets a fresh initial password of the usual `penguin-1234` form, printed in the framed notice — and re-printed on every server start until it is changed — and all of admin's sign-in sessions are cleared. Other accounts are reset by the admin on the user-management page; this command only touches `admin`. The data root is selected by `PENGUIN_HOME` as usual.

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
