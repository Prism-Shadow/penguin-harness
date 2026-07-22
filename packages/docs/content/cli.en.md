---
title: CLI Reference
description: Complete reference for the penguin command, its subcommands, and options.
---

The CLI ships as the npm package `@prismshadow/penguin-cli`; the command is `penguin`. Running bare `penguin` prints help; `-v, --version` prints the version. A `.env` file in the working directory is loaded automatically on startup.

## Global conventions

- Model references: a model's identity is always the `(provider, model_id)` pair. `--model-id` takes the upstream model id and `--provider` the group it belongs to; the provider is never inferred, guessed, or defaulted. On `run` / `chat` the pair as a whole is optional — pass both to pick a model, or neither to use the Project's default model — but passing one without the other is an error.
- Data root: `--root <dir>` overrides the data root directory. Priority: `--root` > the `PENGUIN_HOME` env var > `~/.penguin/data`.

## penguin run

Send a single message, execute one Task, then exit. If the Task aborted, the exit code is non-zero, so scripts / CI can check it.

```bash
penguin run -m "Summarize the code structure of this directory"
```

| Option | Description |
| --- | --- |
| `-m, --message <message>` | Required; the message to send |
| `--model-id <id>` | Upstream id of the model to use; requires `--provider`. Omit both to use the Project's default model |
| `--provider <group>` | Provider group of the model; required whenever `--model-id` is given |
| `--project-id <id>` | Project to use |
| `--agent-id <id>` | Agent to use |
| `--workspace <path>` | Workspace directory; defaults to the current directory and must exist |
| `--approve <mode>` | Approval mode, see below |

## penguin chat

Interactive REPL; each input line starts a Task. Takes the same options as `run` (minus `-m, --message`), plus:

| Option | Description |
| --- | --- |
| `--resume [sessionId]` | Resume a Session; without an id, resumes the Agent's latest Session |

With `--resume`, the Workspace and model are locked by the original Session and cannot be overridden via `--workspace` / `--model-id` / `--provider`. On exit, a copy-pastable `penguin chat --resume <sessionId>` command is printed.

In-REPL commands:

| Input | Behavior |
| --- | --- |
| `/compact` | Proactively compact the current context |
| `/exit`, `/quit` | Quit |

Ctrl-C is state-dependent:

| State | Behavior |
| --- | --- |
| Awaiting tool approval | Deny that tool call |
| Task running | Abort the current Task and return to input |
| Input buffer non-empty | Clear the current input |
| Idle with empty buffer | Show an exit confirmation (y/N) |

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
| `--price-cache-read <n>` | Cache-read price |
| `--price-cache-write <n>` | Cache-write price |
| `--price-output <n>` | Output price |
| `--set-default` | Also set as the default model |

### model default / model vision / model list

```bash
penguin config model default --model-id <id> --provider <group>
penguin config model vision --model-id <id> --provider <group>
penguin config model list
```

- `model default` sets the Project's default model; `model vision` sets the vision proxy model. Both require `--model-id` and `--provider`, and the reference must already exist in the model list.
- `model list` lists configured models; the default model is marked with `*`.

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

See also: [Configuration Reference](/configuration), [Models & Providers](/models).
