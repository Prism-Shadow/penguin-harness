---
title: CLI Reference
description: Complete reference for the penguin command, its subcommands, and options.
---

The CLI ships as the npm package `@prismshadow/penguin-cli`; the command is `penguin`. Running bare `penguin` prints help; `-v, --version` prints the running build's one-line identity, and `penguin version --json` prints the whole of it. A `.env` file in the working directory is loaded automatically on startup.

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
| `--thinking <level>` | Thinking level for the Session: `low` / `medium` / `high` / `xhigh` / `max`. Omitted, the configured chain applies (the Agent's `model.thinking_level`, else the Project's `default_chat.thinking_level`, else `medium`). Pinned at Session creation, so spawned subagent sessions follow it |

## penguin chat

Interactive REPL; each input line starts a Task. Takes the same options as `run` (minus `-m, --message`), plus:

| Option | Description |
| --- | --- |
| `--resume [sessionId]` | Resume a Session; without an id, resumes the Agent's latest Session |
| `--verbose` | Show full tool output; by default long tool outputs are collapsed (see below) |

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
