---
title: Configuration Reference
description: Every PenguinHarness setting with its default and constraints, from environment variables to the Project, agent, memory, Vault and schedule files.
---

PenguinHarness configuration has three layers: environment variables shape the deployment, the Project config manages models and credentials, and the agent config defines one agent's behavior. Each agent also keeps state files for its [Memory](#memory), [Vault](#vault) and [Schedules](#schedules).

## Environment variables

The CLI and the server load a `.env` file from the working directory on startup.

| Variable | Description | Default |
| --- | --- | --- |
| `PENGUIN_HOME` | Data root directory | `~/.penguin/data` |
| `PORT` | Web service listen port | `7364` |
| `HOST` | Web service listen address | `127.0.0.1` |
| `PENGUIN_WEB_DB` | Server SQLite database path | `<root>/web.db` |
| `PENGUIN_WEB_DIST` | Front-end static assets directory | The server package's bundled `web-dist` (in a source checkout, `packages/web/dist`) |
| `PENGUIN_PREVIEW_ORIGIN` | Origin that serves Workspace HTML previews, e.g. `https://preview.example.com` | Unset: the loopback counterpart is derived per request |
| `PENGUIN_GO_ORIGIN` | Trusted origin the server-side Penguin Go key authorization calls | `https://token.penguin.ooo` |
| `MODELSCOPE_BRIDGE_URL` | Address of the authorization bridge the server-side ModelScope key authorization calls | `https://go.penguin.ooo/modelscope` |
| `PENGUIN_TRUST_PROXY` | `1` trusts the `x-forwarded-proto` header | Unset: the header is ignored |
| `PENGUIN_SEED_ADMIN_PASSWORD` | Fixed initial password for the seeded built-in admin (automated tests / e2e) | Unset: a random password is generated |
| `PENGUIN_LANG` | CLI language (`en` / `zh`), set with `penguin config lang` | `en` |
| `PENGUIN_UPDATE_CHECK` | `off` disables the Web App's new-release check | Enabled |
| `PENGUIN_NO_LOGIN_SHELL_ENV` | Any non-empty value stops the desktop app from importing the login shell's environment on macOS/Linux GUI launches | Unset: the import runs |
| `PENGUIN_SHELL` | The shell that runs agent commands (an executable name or path) | Unset: picked automatically, see [Tools & Approval](/tools#command-sessions) |
| `PENGUIN_CLI_ENTRY` | The CLI entry script this installation offers the agents it runs (see [PATH launcher](#path-launcher)) | Set by `penguin server` / `penguin web` and by the desktop app |

Notes:

- `PENGUIN_TRUST_PROXY`: set it behind a reverse proxy that terminates TLS and sets or strips the header itself. Session cookies are then marked `Secure`, and the hot-update network gate sees HTTPS.
- `PENGUIN_SEED_ADMIN_PASSWORD`: without it, the seed generates a random password that is hashed and discarded unseen, and you claim the account through the first-login link.
- `PENGUIN_GO_ORIGIN`: server configuration, not an endpoint the browser can name. It must be a bare HTTPS origin; plain HTTP is accepted only for `localhost`, `127.0.0.1` and `[::1]`, for integration environments. A path, credentials, a query string or a fragment is rejected at startup. See [Authorize a new API key](/models#authorize-a-new-api-key).
- `MODELSCOPE_BRIDGE_URL`: server configuration like `PENGUIN_GO_ORIGIN`, not an endpoint the browser can name. It must be an HTTPS address with no credentials, query string or fragment. Unlike `PENGUIN_GO_ORIGIN`, a path prefix **is** allowed, because the production bridge lives under `https://go.penguin.ooo/modelscope`. See [Authorize a new API key](/models#authorize-a-new-api-key).
- `PENGUIN_UPDATE_CHECK`: `off` turns off the automatic release check, nothing else. Model requests, an enabled remote-control connection, provider key authorization and the proxy test still reach the network.
- `PENGUIN_NO_LOGIN_SHELL_ENV`: without it, the import fills only variables the launch left unset. See [Desktop quickstart](/quickstart-desktop).
- `PENGUIN_CLI_ENTRY`: when the server was started from a source checkout, it falls back to that checkout's `packages/cli/dist/penguin.js`.

### Environment of agent-run commands

Commands an agent runs with `exec_command` inherit the host environment, with these changes:

- **Removed:** `PORT`, `HOST`, `FORCE_COLOR`, `CLICOLOR_FORCE` and every `PENGUIN_*` variable. They configure PenguinHarness itself, not the command. Without this, a dev server started by `exec_command` would read `PORT` and try to bind the port meant for PenguinHarness instead of choosing its own.
- **Proxy:** in Sessions the server runs, the **Agent environment uses the proxy** switch in [System settings](/settings#proxy-options) decides the proxy variables. Off removes `HTTP_PROXY`, `HTTPS_PROXY` and `ALL_PROXY`; on injects the configured proxy address, or passes the host's variables through when no address is set.
- **Vault:** the agent's [Vault](#vault) is applied on top, so setting `PORT` or a `PENGUIN_*` variable there does reach commands.
- **Control variables:** a server-driven Session then injects `PENGUIN_API_URL`, `PENGUIN_API_TOKEN`, `PENGUIN_PROJECT_ID`, `PENGUIN_AGENT_ID` and `PENGUIN_SESSION_ID` (plus `PENGUIN_ORG_ID` in company mode), so the agent's own `penguin` calls reach the server that runs it. These override Vault entries of the same name. See [CLI Reference](/cli).
- **Forced:** `GIT_EDITOR`, `GIT_TERMINAL_PROMPT`, `TERM`, `NO_COLOR`, `PAGER` and `GIT_PAGER` always get fixed values, so a command cannot hang waiting on an editor, a credential prompt or a pager. Nothing overrides them, the Vault included.

### PATH launcher

This installation's own `penguin` is first on the PATH of every command an agent runs. At startup the server writes a launcher script at `<root>/bin/penguin`, which runs the CLI entry from `PENGUIN_CLI_ENTRY` on the server's own Node, and puts that directory at the front of PATH for each command. So `penguin` inside a command is the harness the agent is running in, whatever version is installed globally on the machine.

The directory is prepended inside the shell as well as in the environment, because commands run through a login shell whose profile often rewrites PATH afterwards. This also puts it ahead of a `PATH` set in the [Vault](#vault), which otherwise replaces the inherited value outright.

The launcher is rewritten at every start, so the next start picks up a moved installation. When there is no entry to point at, no launcher is written and `penguin` resolves as it would without one.

### Workspace preview origin

`PENGUIN_PREVIEW_ORIGIN` must differ from the app's origin by **hostname**, not just by port: cookies ignore ports, so a second port would still share the session cookie.

- **Local use:** leave it unset. The app is canonicalized onto `localhost` and previews are served from `127.0.0.1`, which needs no configuration and no DNS.
- **LAN address or real domain:** set it. Otherwise previews fall back to a same-origin sandbox where `localStorage`, cookies and third-party embeds do not work. On a real domain, keep the session cookie host-only (no `Domain=`), or a sibling subdomain shares it.

An unparseable value stops the server at startup instead of falling back silently.

### Provider credential variables

When a model entry has no inline `api_key`, AgentHub falls back to the provider's environment variable. A `*_BASE_URL` value is used only when the entry does not inline `base_url`.

| Provider | API key | Base URL |
| --- | --- | --- |
| deepseek | `DEEPSEEK_API_KEY` | `DEEPSEEK_BASE_URL` |
| anthropic | `ANTHROPIC_API_KEY` | `ANTHROPIC_BASE_URL` |
| openai, openrouter, fireworks, siliconflow, tokendance, qwen-pay-as-you-go, qwen-token-plan, modelscope, vllm, custom | `OPENAI_API_KEY` | `OPENAI_BASE_URL` |
| penguin-go | `PENGUIN_GO_API_KEY` | `PENGUIN_GO_BASE_URL` |
| minimax | `MINIMAX_API_KEY` | `MINIMAX_BASE_URL` |
| google | `GEMINI_API_KEY` | `GEMINI_BASE_URL` |
| zhipu | `ZAI_API_KEY` | `ZAI_BASE_URL` |
| moonshot | `MOONSHOT_API_KEY` | `MOONSHOT_BASE_URL` |

The openrouter, fireworks, siliconflow, tokendance, qwen-pay-as-you-go, qwen-token-plan, vllm and custom groups speak an OpenAI-compatible protocol, hence the shared `OPENAI_*` variables. ModelScope also shares `OPENAI_*` because its group credential is an api-inference token, even when a preset row pins a model-specific protocol. The Penguin Go relay keeps a pair of its own, so the app never offers a vendor credential for it. The direct MiniMax M3 Responses client uses `MINIMAX_*`, and the built-in MiniMax preset already pins the official endpoint. For provider groups and the built-in model catalog, see [Models & Providers](/models).

## Project config

`<root>/<project>/.project_config.toml` is the Project's single config file: a hidden file written with mode 0600, with credentials inlined on the model entries. A model's identity is always the `(provider, model_id)` pair. Strings are never concatenated into one id, every reference into this file carries both halves, and the provider is never inferred from a bare `model_id`.

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `name` | string | — | Project display name; the id is shown when unset |
| `default_model` | pair | — | Paired `{ provider, model_id }` reference to the default model; must point to an entry in `models` |
| `vision_model` | pair | — | The vision model that reads images for text-only models (`read_file` hands images to it); a paired reference |
| `[default_chat]` | table | — | Prefilled defaults for new chats; see [New chat defaults](#new-chat-defaults) |
| `[command_policy]` | table | Factory set | Deny rules for shell commands, applied ahead of the approval mode; see [Command policy](#command-policy) |
| `[plugins]` | table | — | The server plugins the Project asks for; see [Plugins](#plugins) |
| `[[models]]` | array of tables | — | The available model entries |

### Model entries

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `provider` | string | — | Provider group; with `model_id`, the entry's unique key |
| `model_id` | string | — | Upstream request id, sent to AgentHub unchanged |
| `context_window` | number | — | Context window size |
| `client_type` | string | Inferred from `model_id` | AgentHub client protocol |
| `display_name` | string | The built-in catalog name | Display name; persisted only when it differs from the catalog |
| `vision` | boolean | `true` | Whether the model accepts image input |
| `max_tokens` | number | The agent's `model.max_tokens` | Per-model max output Tokens; overrides the agent's `model.max_tokens` when set |
| `fast_mode` | boolean | Off | Per-model fast mode (the provider's premium faster serving tier) |
| `pricing` | table | — | Three price buckets, `cache_read` / `cache_write` / `output`, in USD per million Tokens (`unit = "usd_per_mtok"`). Always the list price |
| `api_key` | string | The provider's environment variable | Inline credential |
| `base_url` | string | Preset for some catalog entries | Custom base URL |
| `created_at` | string | — | When `api_key` was written (ISO 8601); a display field maintained by the interface layer |

Field notes:

- `client_type`: custom endpoints use a generic protocol client: `openai-responses`, `ant-messages` or `openai-chat`. The Web dialog can detect which one a base URL serves. The pre-0.4.2 spelling `openai` is a deprecated alias of `openai-chat`, normalized on read.
- `fast_mode`: only `true` is persisted. It is offered only for models whose AgentHub client can serve it, and the others reject requests that carry it. See [Models](/models#fast-mode).
- `pricing`: the figure here is the list price. A running promotion is not written to this file: the server keeps it in `web.db` and takes it off when it computes cost. See [Prices and promotions](/models#prices-and-promotions).
- `base_url`: the built-in catalog presets it for gateways and for the direct rows that pin a client, MiniMax M3 and DeepSeek `deepseek-flash`.
- `api_key`: when empty, AgentHub falls back to the provider's environment variable.

```toml
default_model = { provider = "deepseek", model_id = "deepseek-flash" }

[[models]]
provider = "deepseek"
model_id = "deepseek-flash"
context_window = 1000000
vision = true
client_type = "deepseek-v4"
base_url = "https://api.deepseek.com"
api_key = "sk-..."

[models.pricing]
unit = "usd_per_mtok"
cache_read = 0.005714
cache_write = 0.285714
output = 1.142857
```

`pricing.unit` is currently always `usd_per_mtok` (USD per million Tokens). The three buckets map onto the three counters of `token_usage`.

Edit this file with the CLI (`penguin config model …`) or on the Web App's Models page.

> [!WARNING]
> Do not edit `.project_config.toml` by hand while the service is running. The model has no right to read or write it.

### New chat defaults

The `[default_chat]` block prefills new chats in the Web App. It is managed on the **Defaults** tab of **Project settings**. Every key is optional and independent, and an invalid value is dropped on load without affecting the other keys.

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `agent_id` | string | — | The agent preselected for a new chat; must name an existing agent |
| `workspace` | string | A temporary Workspace | The prefilled Workspace directory |
| `approval_mode` | string | `allow-all` | The prefilled approval mode: `allow-all`, `deny-all`, `read-only` or `always-ask` |
| `thinking_level` | string | — | Fallback thinking level (`low` / `medium` / `high` / `xhigh` / `max`) for agents whose config sets no `model.thinking_level` |

The default model is not part of this block: it stays the top-level `default_model`.

### Plugins

The `[plugins]` table lists the [server plugins](/skills#server-plugins) the Project asks for. It is managed on the **Plugins** page. Each key is a package name, and each value is a requirement in the shape of Cargo's `[dependencies]`:

```toml
[plugins]
"@prismshadow/penguin-plugin-sandbox-bwrap" = "*"
"@scope/name" = "1.2.3"
"@scope/other" = { version = "1.2" }
```

- `"*"` asks for whatever version the deployment ships. A version string and the `{ version = "…" }` form are kept as the requirement; loading currently goes by the package name alone.
- The server runs the union of every Project's table, so a plugin one Project asks for is loaded for all of them.
- An entry of any other shape is dropped when the file is read, and the rest of the file still loads. A `plugins` key that is not a table asks for no plugins.
- An empty table is written as an empty table: the Project asks for no plugins.

## Command policy

The `[command_policy]` block is the Project's guardrail for shell commands: a list of deny rules applied at the approval boundary itself.

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | On | Master switch; stored only as `enabled = false` |
| `[[command_policy.rules]]` | array of tables | The factory set | The deny rules, matched in order. A stored empty list means no rules; an absent list means the factory set |

Each rule has these keys:

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `name` | string | — | Identifies the rule in the settings UI |
| `pattern` | string | — | JavaScript regex source, matched against the whitespace-normalized command |
| `description` | string | — | Optional description |
| `enabled` | boolean | On | Per-rule switch |

```toml
[command_policy]
enabled = true

[[command_policy.rules]]
name = "rm-recursive-force"
pattern = "…" # seeded from the factory set
description = "rm with recursive + force flags in one command (rm -rf and friends)"

[[command_policy.rules]]
name = "no-force-push"
pattern = "git push [^;|&]*--force"
enabled = false
```

Manage the policy on the **Security policy** tab of **Project settings** in the Web App. Only the Project owner can edit it; members see the effective policy.

### Enforcement

- **What it checks:** both tools that reach a shell: `exec_command`'s `cmd` (the launch) and `input_command`'s `chars` (what gets typed into a running command).
- **When it applies:** `Session.run` wraps the injected approval callback with the policy, so a hit is rejected before the host is asked, under every approval mode, allow-all included.
- **What the model sees:** the fixed line `Tool call denied by policy.`, distinct from a person's cancellation, so the model changes course.
- **Hooks:** the policy outranks a [pre-tool-use hook's](/agent-loop#pre-tool-use-hooks) `allow`. A vetoed call stays forbidden whatever an installed hook answers.
- **Where it lives:** in the Project config, not in Agent State, so an agent that edits its own configuration through its settings cannot reach it.
- **When edits apply:** the policy is a strict-tier runtime parameter, read once when a model context opens. An edit reaches a running Session at its next rotation (compaction) and new conversations at once.

### Factory rules

The rules are **plain data with no special tiers**. The factory set is seeded into each new Project exactly like the model presets: copied in at creation and never rewritten afterward. Every rule can then be edited, disabled or deleted, and you can add your own. A Project created before the seeding (no stored `rules` list) behaves as the factory set until its first saved edit writes the list. On the settings page, **Restore defaults** loads the factory set back into the editor, and saving writes it.

The factory set is deliberately small. It covers commands whose verbatim execution is destructive with no undo:

- `rm` with both a recursive and a force flag
- `mkfs`
- `dd` writing straight to a block device
- the classic fork bomb
- shell redirection onto a block device (`/dev/null` and friends stay allowed)

Four more rules cover the same ground in Windows spellings, since `exec_command` can resolve pwsh or cmd there:

- a recursive force delete (`Remove-Item -Recurse -Force`, `rd /s /q`)
- a volume format (`format C:`, `Format-Volume`)
- a raw disk overwrite (`\\.\PhysicalDriveN`, `Clear-Disk`)
- the cmd fork bomb

### Matching

Before the rules run, matching normalizes ordinary spellings so that plain typing does not slip through by accident. All of these match:

- a leading path (`/bin/rm`)
- a wrapper (`sudo`, `env`, `command`, `nice`, `xargs`)
- quoting or a backslash escape of the command word (`"rm"`, `r''m`, `\rm`)
- a literal `sh -c 'rm -rf /'` payload

Normalization only removes quote marks. Nothing is expanded, substituted or decoded.

### What the policy does not cover

The command policy is an **accident guardrail, not a security boundary**. This is a statement about what pattern matching can do, not modesty about this implementation. Shell is a programming language, and more rules do not get closer to deciding what a program will do by reading its text before it runs. The policy covers the spellings people and models actually type, and stops there:

- **Commands computed at run time are not covered and will not be.** Examples: `$IFS` in place of spaces, a variable or alias (`X=rm; $X -rf /`), a command substitution, `eval`, base64 piped into a shell, `python -c`, an interpreter reached through a pipe. Each would need a pattern that costs maintenance forever and buys only the appearance of coverage. Anyone who wants the command to run can get it to run.
- **MCP tools are a different surface.** The policy reads `exec_command` and `input_command` only. An MCP server's own `permission` level is the setting that exists there, but it only fixes the level the server's tools report to the approval mode. It does not sandbox the server or restrict what its tools do when they run (see [Tools & Approval](/tools)). Extending a shell-text matcher to arbitrary MCP arguments would add a second, weaker control to a surface that needs a real one.
- **Commands not on the list are not covered.** `shred`, `wipefs`, `find -delete`, `git clean -xfd` and `chmod -R 000 /` match no factory rule. Add your own rules for what your Project cares about.
- **It is not a filesystem permission.** A tool that writes arbitrary paths can still rewrite the config file itself, and the change takes effect at the next rotation.

What the policy does buy: a destructive one-liner does not run by accident, through either tool that reaches a shell, in POSIX or Windows spelling, under any approval mode. That is a speed bump, and a speed bump is worth having in front of an irreversible command. For an actual boundary, a process that cannot reach the rest of the filesystem whatever it runs, the mechanism is confinement (bubblewrap, dsh), a separate layer this policy complements rather than replaces.

## Agent config

`agent_state/system_config.yaml` defines one agent's behavior. It is YAML, and comments are preserved when you edit it in the Web App.

| Field | Default | Description |
| --- | --- | --- |
| `name` | — | Agent display name; falls back to the id |
| `description` | — | Agent description |
| `version` | `1` | Agent State version (a natural number), incremented on each successful optimization |
| `kernel_version` | The current kernel version | Which generation of the built-in defaults the config is based on (a date string) |
| `system_prompt` | Built-in template | Required; the only template with placeholder substitution |
| `max_turns` | `-1` | Maximum LLM turns per Task |
| `model.max_tokens` | `32000` | Output Token ceiling per Request |
| `model.thinking_level` | `medium` | The thinking level each model context opens at, unless the Session pins one |
| `model.timeoutMs` | `300000` | **Idle** budget for a Request, in milliseconds |
| `compaction.max_context_length` | `256000` | Context Token threshold that triggers compaction |
| `compaction.max_session_turns` | `-1` | Cumulative Session turn threshold |
| `compaction.mode` | `summarize` | `summarize` / `discard` |
| `compaction.prompt` | Built-in template | Prompt used for summarize compaction |
| `memory.enabled` | `true` | Whether Memory enters the context and Memory directories are prepared |
| `memory.prompt` | Built-in template | The always-injected half of the `{{MEMORY}}` block; carries `{{USER_MEMORY_INDEX}}` |
| `memory.workspace_prompt` | Built-in template | Appended only in a persistent Workspace; carries `{{WORKSPACE_MEMORY_INDEX}}` and `{{WORKSPACE_MEMORY_DIR}}` |
| `vault.enabled` | `true` | Whether the Vault section enters the context |
| `vault.prompt` | Built-in template | The `{{VAULT}}` block; carries `{{VAULT_KEYS}}` |
| `skills.enabled` | `true` | Whether the Skills section enters the context |
| `skills.prompt` | Built-in template | The `{{SKILLS}}` block; carries `{{SKILL_METADATA}}` |
| `schedules.enabled` | `true` | Whether the scheduled-tasks section enters the context |
| `schedules.prompt` | Built-in template | The `{{SCHEDULES}}` block, which teaches file-based task management; carries `{{SCHEDULE_LIST}}` |
| `hooks.enabled` | `true` | Whether a new Session runs the installed hook packages at the loop's hook points |
| `tools.builtin` | The full default toolset when omitted | Tool entries; once written, replaces the default list wholesale |
| `tools.mcpServers` | `[]` | MCP Server configuration (`name` + `config`) |

### Field details

- `kernel_version`: stamped at creation, when defaults are restored and at a kernel update. It is unrelated to `version` and never changed by your edits. A missing value means the config predates the mechanism, which counts as outdated.
- `max_turns`: `-1` means unlimited; a positive integer caps the Task.
- `model.max_tokens`: `-1` means no cap (the provider default). Each request clamps the effective value to the model's `context_window` minus the estimated input, so a small-window model is never asked for more than fits.
- `model.thinking_level`: `none` / `low` / `medium` / `high` / `xhigh` / `max`. The level is fixed for a model context, so a change lands at the next compaction. Without this field, the Project's `[default_chat]` `thinking_level` applies, then `medium`.
- `model.timeoutMs`: the longest wait for the next upstream event, reset by every event. It is not a cap on the request's total duration. It bounds the wait to connect and receive the first event, and the gaps between events. A model that keeps its reasoning off the wire spends its whole thinking phase inside that first gap, which the default leaves room for.
- `compaction.max_context_length`: the effective threshold is the smaller of this value and the model's `context_window` − 2048. A small-window model therefore compacts inside its window, while a window above 258048 fires at this number. An entry with no `context_window` assumes a 128000 window.
- `compaction.max_session_turns`: `-1` means unlimited.
- `*.prompt`: each section prompt is editable on its settings tab: both Memory prompts on **Memory**, `vault.prompt` on **Vault**, `skills.prompt` on **Skills**, and `schedules.prompt` on **Schedules**.
- `vault.enabled`: when off, values are still injected into subprocess environments; the model just does not see the key-name list.
- `skills.enabled`: when off, installed Skills can still be invoked explicitly with `[use_skills]`.
- `schedules.enabled`: when off, the server still fires tasks; the model just is not taught the task system.
- `hooks.enabled`: the one section with no prompt half, because hook packages are scripts, not context text. When off, the packages stay installed and nothing consults them.
- `tools.builtin`: each entry has `name` / `description` / `parameters` / `permission` (`r` or `rw`) / `forModel` / `timeoutMs` / `maxOutputLength` / `call_description`. `call_description` is the per-tool switch for the `description` call argument, which is required while on; missing means kept.
- `tools.mcpServers`: the transport is `stdio`, `http` or `sse`, and discovered tools join the toolset as `mcp__<server>__<tool>`. `config.permission` (`auto` / `r` / `rw`, default `auto`) fixes the approval level of every tool of that server instead of trusting its `readOnlyHint`. See [MCP Servers](/tools#mcp-servers).

The four `compaction.*` fields are the one part of this file a running conversation does not wait for. The engine re-reads the section at every compaction checkpoint (after each request reports its token usage, and on a manual `/compact`), so a saved change applies to Sessions already running. Everything else is read when a model context opens and lands at the next compaction. In the Web App you can also [change the threshold](/chat#change-the-compaction-threshold) from the context panel by dragging the dashed cutter on its bar.

For tool permissions and approval semantics, see [Tools & Approval](/tools).

This file is **not deep-merged with the defaults**. A key you write out takes effect wholesale, and only omitted keys fall back to the defaults above where they are used. `system_prompt` is required and loading refuses a file without it, so keep the full generated template when you edit other fields. A partial-override example, edited from the file the init step generated:

```yaml
name: default_agent
description: General-purpose agent
version: 3

# Required: keep the full generated default template ({{AGENTS_MD}} and friends; elided here).
system_prompt: |
  …

# -1 (the default) = unlimited; set a positive integer to cap the turns of a single Task.
max_turns: -1

model:
  max_tokens: 32000
  thinking_level: medium
  timeoutMs: 300000

compaction:
  max_context_length: 256000
  max_session_turns: -1
  mode: summarize

# Omitting the whole tools section = the full default toolset. Writing tools.builtin
# REPLACES the default list wholesale: carry the complete definition (including the
# parameters JSON Schema) for every tool you keep — see Tools & Approval.
```

### Kernel updates

An existing agent always runs with its on-disk config as written; newer code defaults are never merged in automatically. When the built-in defaults change substantively, the config's `kernel_version` falls behind the current kernel, and the settings page and the agents list show an update hint. Two actions on the settings overview adopt the current defaults.

**Update kernel** is a lossless merge, done one settings tab at a time (**System Prompt**, **Runtime**, **Tools**, **Skills**, **Memory**, **Vault**, **Schedules**):

- A tab the config lacks entirely, or one whose hash still matches a *recorded* generation's built-in default, is rewritten from the current defaults. This is also how tools added by a later version reach an existing agent.
- A tab you have changed in any way stays unchanged **in full** and is listed in the result. If you edit one built-in tool, the whole **Tools** tab is kept: tools you added and tools you deleted both survive, and that tab stops following new defaults until you restore defaults.
- `name`, `description`, `version`, `hooks` and `tools.mcpServers` belong to no tab and are never touched.
- The config is then stamped with the current `kernel_version`.
- Matching is **conservative**: only a tab whose hash matches a recorded generation counts as an old default. A tab from a generation too old to be recorded is kept as if customized.

**Restore default configuration** works like a Skill update: it overwrites the configuration with the current defaults and keeps only `name`, `description` and `version`. Everything else is replaced, including a custom system prompt, the tool list, the model and compaction settings, and MCP Servers. Use it as the full refresh when the kernel update's conservative matching leaves fields behind.

For developers:

- `kernel_version` advances manually, and only on a substantive change to the built-in defaults, using that day's date. Several changes on the same day may reuse that day's version.
- The pinned-hash test in CI (`core/test/kernel-version.test.ts`) recomputes every tab hash against `KERNEL_DEFAULT_TAB_HASHES` in `kernel-history.ts`. On drift it fails and names each tab that moved and the edit it needs: bump `KERNEL_VERSION`, append the tab's previous hash to `KERNEL_SUPERSEDED_TAB_HASHES`, and write in the recomputed hash.
- The superseded hashes are frozen forever: they are what identifies a tab that is still the old default.

### System prompt placeholders

`system_prompt` is the only template with placeholder substitution. The available placeholders:

| Placeholder | Injected content |
| --- | --- |
| `{{AGENTS_MD}}` | Full text of `AGENTS.md` |
| `{{VAULT}}` | The rendered `vault.prompt` block (the Vault section); empty when `vault.enabled` is off |
| `{{SKILLS}}` | The rendered `skills.prompt` block (the Skills section); empty when `skills.enabled` is off |
| `{{MEMORY}}` | The rendered `memory.prompt` block, plus `memory.workspace_prompt` in a persistent Workspace; empty when Memory is off |
| `{{SCHEDULES}}` | The rendered `schedules.prompt` block (the scheduled-tasks section); empty when `schedules.enabled` is off |
| `{{VAULT_KEYS}}` | Inside `vault.prompt`: the Vault key-name list (names only, one `- KEY` line per key) |
| `{{SKILL_METADATA}}` | Inside `skills.prompt`: the installed Skills' metadata lines |
| `{{SCHEDULE_LIST}}` | Inside `schedules.prompt`: the current task-name list (one `- name` line per task; an empty-roster note when none exist) |
| `{{USER_MEMORY_INDEX}}` | Inside the Memory prompts: the user scope's `MEMORY.md` index (at most 200 lines and 25,000 characters total) |
| `{{WORKSPACE_MEMORY_INDEX}}` | Inside `memory.workspace_prompt` only: the Workspace scope's `MEMORY.md` index (at most 200 lines and 25,000 characters total) |
| `{{WORKSPACE_MEMORY_DIR}}` | Inside `memory.workspace_prompt` only: absolute path of the current Workspace's Memory directory |
| `{{PLATFORM}}` | Runtime platform |
| `{{OS_VERSION}}` | Operating system version |
| `{{DATE}}` | Current date |
| `{{PROJECT_DIR}}` | App Data Dir: the PenguinHarness app data root (the Project directory) |
| `{{AGENT_ID}}` | Agent id |
| `{{CWD}}` | Workspace path |
| `{{PROVIDER}}` | Model provider group |
| `{{MODEL_ID}}` | Upstream model id |
| `{{SESSION_ID}}` | Session id |

**Section placeholders.** The Vault, Skills, Memory and Schedules sections share one pattern: a placeholder, a switch and an editable prompt. The template holds only the `{{VAULT}}` / `{{SKILLS}}` / `{{MEMORY}}` / `{{SCHEDULES}}` placeholder, the section text lives in the matching `*.prompt` key (edited on its settings tab), and turning `*.enabled` off empties the whole block. A template without one of these placeholders injects no such section; the matching settings tab offers to insert the placeholder explicitly, or to migrate a legacy template. The four section placeholders are expanded last, in a single pass at assembly time. Expanded text is never rescanned, so placeholder-looking text inside a memory index or a section prompt stays literal.

**App Data Dir.** `{{PROJECT_DIR}}` is shown to the model as the **App Data Dir**: PenguinHarness's application data root, which holds every agent's data files (`agents/<agent_id>/…`) and the Project-level data. It is deliberately not described as a project or task directory, so the model does not mistake it for the task's working directory (`CWD`).

**Windows paths.** On Windows, `{{PROJECT_DIR}}` and `{{CWD}}` are injected with forward slashes, like every other path core composes for the model (attachment lines, the goal-file line, truncated-output recovery paths). The model copies these spellings into JSON tool arguments and shell commands. Node's fs APIs and the package's (Git) Bash tool shell accept forward slashes, and they avoid JSON backslash-escaping mistakes.

**AGENTS.md.** `agent_state/AGENTS.md` is the developer-editable instruction file, injected through `{{AGENTS_MD}}` and empty by default. It is also the file an optimizer edits most; see [Self-Improvement](/self-improvement). Like the rest of the Agent State, `system_config.yaml` included, it is read whenever a model context opens: at Session creation, and again when a compaction opens the next context. An edit therefore takes effect at the next compaction of a running Session, not only in new Sessions, and never inside the running context. The `compaction` section is the exception; see [Compaction](/agent-loop).

**Legacy templates.** `system_config.yaml` is written at agent creation and never upgraded automatically. An agent created before the section placeholders carries hardcoded `# Vault` / `# Skills` section text with inline `{{VAULT_KEYS}}` / `{{SKILL_METADATA}}` in its template. Such templates keep working: the inline placeholders are still substituted and honor the section switches (an off switch substitutes an empty string). The matching tab reports the legacy template and offers one-click migration, which replaces the old default section text verbatim, in place, with the new placeholder and leaves the assembled prompt unchanged. If the section text was customized, verbatim migration does not match; the template is treated as missing the placeholder, with a one-click insert before `# Environment`.

## Memory

`agent_state/memory/` holds what the agent remembers between Sessions: user feedback, project decisions, working conventions and entry points into external systems, the things that cannot be re-derived from the Workspace or its code history. It is not context compaction, which preserves one Session's short-term state.

Memory has two scopes. Both belong to one agent and are never shared with another agent:

- **User scope** (`memory/user/`): what stays true wherever the agent works, such as who the user is, their standing preferences, and reference material not tied to one codebase. Every Session reads it, including one running in a temporary Workspace, which has no other place to write.
- **Workspace scope** (`memory/<workspace_memory_key>/`): facts about one Workspace. Sessions of the same agent in the same Workspace share it; different Workspaces keep their topic files apart.

```text
agent_state/memory/
├── user/                         # user scope (no marker: it stands for no path)
│   ├── MEMORY.md                 # this scope's index
│   └── prefers-pnpm.md
└── my-app-a81f32c4/              # one Workspace
    ├── .workspace                # the Workspace path this key stands for
    ├── MEMORY.md
    └── testing-conventions.md
```

Each scope has its own `MEMORY.md` index, and different agents never share Memory, even in the same Workspace. Because Memory lives in Agent State, it travels with export, import and snapshots.

> [!WARNING]
> Every Project member who can reach the agent can read its Memory. Keep credentials and sensitive personal data out of it.

To read or delete memories, or to ask the agent to edit them, use the **Memory** tab of the [agent settings](/agents).

### Workspace memory keys

A workspace memory key is `<safe-basename>-<8 hex of the real path's sha256>`.

- `user` is a reserved directory name. It is safe because every generated key has the form `<base>-<8 hex>` and so always contains a hyphen.
- Identity is the directory itself and has nothing to do with Git. Two symlinks to one directory resolve to one key, while moving or renaming a directory makes it a new Workspace; the old Memory stays on disk under the old key.
- A temporary Workspace, one PenguinHarness allocated under `agents/<agent_id>/workspaces/`, gets no Workspace scope at all, including when a subagent inherits it. A temporary Workspace is allocated per Session, so no later Session would ever run there to read it back. Such a Session still gets the user scope, which is where anything it learns belongs anyway.

### Topic files

Each topic file holds one fact or subject, not one file per Task, Session or date, and carries frontmatter:

```markdown
---
name: testing-conventions
description: the project's test environment and verification rules
updated_at: 2026-08-07
---

- Integration tests connect to a real database; no mock repositories.
```

These three fields are all the frontmatter there is. The directory says which scope a memory belongs to, so there is no `type` field; a `type:` line left in an earlier file is ignored as an unknown field.

The default Memory prompt tells the model what to save:

- who the user is and how they want the agent to work, with the reason
- goals, decisions and constraints that cannot be derived from the code
- pointers to external systems, documents and resources

It also names the moments that produce such a fact: a request made a second time, a correction that holds beyond the current task, a habit or practice stated more than once, or a reusable working detail the agent would otherwise ask for again. A repeat only makes a fact obvious; one clear statement of a standing preference is enough. When the agent cannot tell whether something is worth keeping, it asks in the conversation.

The prompt rules out:

- facts the code, config or Git history already states
- unconfirmed guesses
- transcript excerpts (asked to save one anyway, the agent saves the non-obvious part)

Anything else can be saved if the user wants it. For corrections and decisions, the model adds **Why:** and **How to apply:** lines. A memory that proves wrong is deleted together with its index line. Dates are written absolute (`YYYY-MM-DD`), because relative dates mean nothing to a later Session.

### Injection

Only the indexes reach the context, through the template's `{{MEMORY}}` placeholder. Each `MEMORY.md` lists its scope's memories one per line, as `- [Title](file.md) — hook` with links relative to the scope directory. The model updates the index together with the file, deletions included, so the two never disagree.

`{{MEMORY}}` expands to:

- `memory.prompt`: what Memory is for and how to save, then a `## User memory` section with its index (`{{USER_MEMORY_INDEX}}`).
- `memory.workspace_prompt`, only when the Session runs in a persistent Workspace: a `## Workspace memory` section with `{{WORKSPACE_MEMORY_INDEX}}`.

Both prompts are per-agent config, editable on the **Memory** tab, and organized by Markdown headings like the template's other sections. The `User Memory Dir` line is the literal pattern `<app_data_dir>/agents/<agent_id>/agent_state/memory/user`, which the model resolves from the Environment section. The `Workspace Memory Dir` line is rendered already resolved through `{{WORKSPACE_MEMORY_DIR}}`, because its final segment, the workspace memory key, is a path hash the model could not compose itself.

Limits:

- A blank index injects an explicit "nothing saved yet" note.
- Injection is capped at 200 lines per scope (one memory per line by convention), then at 25,000 characters total as a backstop for an index with a few enormous lines. Past a cap, a truncation note tells the model to open the full `MEMORY.md` itself. The file on disk is never touched.
- The default Memory prompt states the line cap and asks for index lines under about 150 characters, so the model keeps the index short before it reaches the caps. The character backstop exists only in code.
- The model reads topic bodies on demand.

The two halves are separate config keys because substitution has no conditionals. A temporary Workspace must never receive the Workspace section (its directory line and the rule for choosing a scope), so that half is simply not appended there. The harness only decides where Memory lives and keeps writes inside it. Deciding what is worth keeping, splitting topics and maintaining the indexes is the model's job, done with the ordinary file tools.

A template without `{{MEMORY}}` injects no Memory; an agent created before Memory shipped is one example. The **Memory** tab reports this and offers to insert the placeholder before `# Environment`, where the default template has it, as an explicit one-click action. Nothing is ever spliced in automatically. The assembled prompt is recorded in `session_meta`.

## Vault

`agent_state/.vault.toml` is the agent-level environment-variable vault: a hidden file written with mode 0600.

- Key names must match `^[A-Za-z_][A-Za-z0-9_]*$` (shell environment variable naming rules). Values are limited to 8,192 characters.
- Values are injected only into tool subprocess environments. They never enter the model context or the Trace.
- Only key names are shown in the system prompt. The template's `{{VAULT}}` placeholder expands to `vault.prompt`, which carries the `{{VAULT_KEYS}}` key-name list and is editable on the **Vault** tab. With `vault.enabled` off the block is empty: values are still injected into subprocesses, and the model just does not see the key names. A legacy template's inline `{{VAULT_KEYS}}` is still substituted under the same switch, and the tab offers one-click migration (see [System prompt placeholders](#system-prompt-placeholders)).
- A saved change reaches new Sessions at once and a running Session at its next compaction, like any other Agent State change. This is the same whether you save in the Web App, through the API or with the CLI.
- Manage it with `penguin config vault set/list/remove` or on the **Vault** tab.

## Schedules

Each file `agent_state/schedule/<name>.toml` describes one scheduled task, which sends a preset Prompt to the agent on a cadence. The file name is the task's identity. Scheduled tasks run only while the Web service (the server runtime) is running. Manage them on the **Schedules** tab of the agent settings or from the chat page; see [Scheduled tasks](/schedules).

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `prompt` | string | Required | The Prompt sent on each trigger |
| `enabled` | boolean | `false` | Whether the task fires |
| `start_at` | datetime (ISO 8601) | Required | First trigger time |
| `period` | string | Omitted: a one-shot task | Cadence such as `30m` / `12h` / `7d`; minimum 5 minutes |
| `end_at` | datetime (ISO 8601) | — | End time; must be later than `start_at` |
| `session_id` | string | — | Binds the task to an existing Session; mutually exclusive with the three fields below |
| `workspace` | string | — | Workspace for new-Session mode |
| `provider` / `model_id` | string pair | The Project's default model | Paired model reference for new-Session mode |

Write both `provider` and `model_id`, or neither. A lone `model_id` is rejected; with neither, the Project's default model is used.

```toml
prompt = "Check yesterday's builds and summarize the failures"
enabled = true
start_at = 2026-08-01T09:00:00Z
period = "12h"
```

The template's `{{SCHEDULES}}` placeholder expands to `schedules.prompt`. It teaches the model to manage these TOML files with its own file tools: the directory, the field rules, the automatic pickup within about 30 seconds, and the rules against duplicates. It ends with the current task-name list through `{{SCHEDULE_LIST}}`. The prompt is editable on the **Schedules** tab. With `schedules.enabled` off the block is empty: the server still fires tasks on schedule, and the model just is not taught the task system. An agent created before this mechanism has no such placeholder in its template, and the tab offers a one-click insert.

## Design principle

An agent's behavior lives entirely in editable files on disk: prompts, Skills and configuration are data, not code. That is what lets agents improve agents: an optimizer edits exactly the files you edit by hand. See [Self-Improvement](/self-improvement) and the [CLI Reference](/cli).
