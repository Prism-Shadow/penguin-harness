---
title: Configuration Reference
description: Complete field reference for environment variables, Project config, Agent config, the Vault, and Schedules.
---

PenguinHarness configuration has three layers: environment variables shape the deployment, the Project config manages models and credentials, and the Agent config defines a single Agent's behavior. Each Agent additionally has two kinds of state files: the Vault (private environment variables) and Schedules (timed tasks).

## Environment variables

The CLI and the server automatically load a `.env` file from the working directory on startup.

| Variable | Description | Default |
| --- | --- | --- |
| `PENGUIN_HOME` | Data root directory | `~/.penguin/data` |
| `PORT` | Web service listen port | `7364` |
| `HOST` | Web service listen address | `127.0.0.1` |
| `PENGUIN_WEB_DB` | Server SQLite database path | `<root>/web.db` |
| `PENGUIN_WEB_DIST` | Front-end static assets directory | the npm server package falls back to its bundled web-dist |
| `PENGUIN_PREVIEW_ORIGIN` | Origin that serves Workspace HTML previews, e.g. `https://preview.example.com` | unset — the loopback counterpart is derived per request |
| `PENGUIN_SEED_ADMIN_PASSWORD` | Fixed initial password for the seeded built-in admin (automated tests / e2e) | unset — a random `penguin-<4 digits>` password is generated and printed once at seed time |
| `PENGUIN_LANG` | CLI language (`en` / `zh`), set via `penguin config lang` | `en` |
| `PENGUIN_UPDATE_CHECK` | `off` disables the web app's new-release check (the server's only outbound internet call) | enabled |

These configure PenguinHarness itself, so `PORT`, `HOST`, `PENGUIN_WEB_DIST` and the internal `PENGUIN_CLI_ENTRY` are **removed from the environment of commands the Agent runs** — otherwise a dev server started by `exec_command` would read `PORT` and try to bind the port meant for PenguinHarness instead of choosing its own. The rest of the host environment passes through, with one further exception: `GIT_EDITOR`, `GIT_TERMINAL_PROMPT`, `TERM`, `NO_COLOR`, `PAGER` and `GIT_PAGER` are always forced to fixed values, so that a command cannot hang waiting on an editor, a credential prompt or a pager. The Agent's [vault](#vault) is applied on top of the host environment — setting `PORT` there does reach commands — but not on top of those six.

`PENGUIN_PREVIEW_ORIGIN` must differ from the app's origin by **hostname**, not just port: cookies ignore ports, so a second port would still share the session cookie. Leave it unset for local use — the app is canonicalized onto `localhost` and previews are served from `127.0.0.1`, which needs no configuration and no DNS. Set it when the app is reached over a LAN address or a real domain; otherwise previews there fall back to a same-origin sandbox where `localStorage`, cookies and third-party embeds do not work. When you do set it on a real domain, keep the session cookie host-only (no `Domain=`), or a sibling subdomain shares it. An unparseable value is a startup error rather than a silent fallback.

### Provider credential variables

When a model entry has no inline `api_key`, the AgentHub gateway falls back to the provider's environment variable; the `*_BASE_URL` variants override the base URL the same way:

| Provider | API key | Base URL |
| --- | --- | --- |
| deepseek | `DEEPSEEK_API_KEY` | `DEEPSEEK_BASE_URL` |
| anthropic | `ANTHROPIC_API_KEY` | `ANTHROPIC_BASE_URL` |
| openai, openrouter, fireworks, siliconflow, qwen-token-plan, qwen-pay-as-you-go, custom | `OPENAI_API_KEY` | `OPENAI_BASE_URL` |
| google | `GEMINI_API_KEY` | `GEMINI_BASE_URL` |
| zhipu | `ZAI_API_KEY` | `ZAI_BASE_URL` |
| moonshot | `MOONSHOT_API_KEY` | `MOONSHOT_BASE_URL` |

The openrouter, fireworks, siliconflow, qwen-token-plan, qwen-pay-as-you-go, and custom groups speak the OpenAI-compatible protocol, hence the shared `OPENAI_*` variables. Provider groups and the built-in model catalog are covered in [Models & Providers](/models).

## Project config

`<root>/<project>/.project_config.toml` is the Project's single config file: a hidden file written with mode 0600, with credentials inlined on the model entries. Model identity is always the `(provider, model_id)` pair — string concatenation is forbidden everywhere, and every reference into this file carries both halves: the provider is never inferred from a bare `model_id`.

| Field | Description |
| --- | --- |
| `name` | Project display name (the id is shown when unset) |
| `default_model` | Paired reference `{ provider, model_id }` to the default model; must point to an entry in `models` |
| `vision_model` | The vision model that reads images on behalf of text-only models (used by `describe_image`); a paired reference |
| `[[models]]` | The list of available model entries |

Model entry (`[[models]]`) fields:

| Field | Description |
| --- | --- |
| `provider` | Provider group; together with `model_id` forms the entry's unique key |
| `model_id` | Upstream request id, sent to AgentHub unchanged |
| `context_window` | Context window size |
| `client_type` | AgentHub client protocol; inferred from `model_id` by default — third-party OpenAI-compatible models should set `openai` |
| `display_name` | Display name; persisted only when it differs from the built-in catalog |
| `vision` | Whether image input is supported; defaults to supported |
| `max_tokens` | Per-model max output tokens; overrides the Agent's `model.max_tokens` when set, omitted = inherit it |
| `pricing` | Three price buckets `cache_read` / `cache_write` / `output`, in USD per million Tokens (`unit = "usd_per_mtok"`) |
| `api_key` | Inline credential; when empty, falls back to the provider environment variable |
| `base_url` | Custom base URL; preset for gateway models |
| `created_at` | Write timestamp of `api_key` (ISO 8601; a display field maintained by the interface layer) |

```toml
default_model = { provider = "deepseek", model_id = "deepseek-v4-flash" }

[[models]]
provider = "deepseek"
model_id = "deepseek-v4-flash"
context_window = 1000000
vision = false
api_key = "sk-..."

[models.pricing]
unit = "usd_per_mtok"
cache_read = 0.003571
cache_write = 0.428571
output = 0.857143
```

`pricing.unit` is currently always `usd_per_mtok` (USD per million tokens); the three buckets map onto `token_usage`'s three counters.

Edit this file via the CLI (`penguin config model …`) or the Web Models page — never by hand while the service is running, and never by the model itself, which has no right to read or write it.

## Agent config

`agent_state/system_config.yaml` defines a single Agent's behavior (YAML; comments are preserved when edited via the Web UI):

| Field | Default | Description |
| --- | --- | --- |
| `name` | — | Agent display name (falls back to the id) |
| `description` | — | Agent description |
| `version` | `1` | Agent State version (a natural number), incremented on each successful optimization |
| `system_prompt` | built-in template | Required; the only template with placeholder substitution |
| `max_turns` | `100` | Maximum LLM turns per Task (-1 removes the cap) |
| `model.max_tokens` | `32000` | Output Token limit per Request (-1 = no cap, provider default) |
| `model.thinking_level` | `medium` | `none` / `low` / `medium` / `high` / `xhigh`; the session default, overridable per-Task |
| `model.timeoutMs` | `120000` | Per-Request timeout (milliseconds) |
| `compaction.max_context_length` | `128000` | Context Token threshold that triggers compaction |
| `compaction.max_session_turns` | `-1` | Cumulative Session turn threshold (`-1` = unlimited) |
| `compaction.mode` | `summarize` | `summarize` / `discard` |
| `compaction.prompt` | built-in template | Prompt used for summarize compaction |
| `memory.enabled` | `true` | Whether Memory enters the context and Memory directories are prepared |
| `memory.prompt` | built-in template | The `{{MEMORY}}` block, editable on the Memory tab; its `[workspace_memory]` region is kept only in persistent-Workspace Sessions |
| `tools.builtin` | full default toolset when omitted | Tool entries: `name` / `description` / `parameters` / `permission` (`r` or `rw`) / `forModel` / `timeoutMs` / `maxOutputLength` / `call_description` (per-tool toggle for the `description` call argument, required while on; missing = kept); once written it replaces the default list wholesale |
| `tools.mcpServers` | `[]` | MCP Server configuration (`name` + `config`); reserved for the MCP adapter layer |

Tool permissions and approval semantics are covered in [Tools & Approval](/tools).

A partial-override example (edit the file the init step generated). Note that this file is **not deep-merged with the defaults**: a key you write out takes effect wholesale, and only omitted keys fall back to the defaults above at their use sites; `system_prompt` is required (loading refuses without it), so keep the full generated template when editing other fields:

```yaml
name: default_agent
description: General-purpose agent
version: 3

# Required: keep the full generated default template ({{AGENTS_MD}} and friends; elided here).
system_prompt: |
  …

max_turns: 100

model:
  max_tokens: 32000
  thinking_level: medium
  timeoutMs: 120000

compaction:
  max_context_length: 128000
  max_session_turns: -1
  mode: summarize

# Omitting the whole tools section = the full default toolset. Writing tools.builtin
# REPLACES the default list wholesale: carry the complete definition (including the
# parameters JSON Schema) for every tool you keep — see Tools & Approval.
```

An existing Agent always runs with its on-disk config verbatim — newer code defaults are never merged in automatically. To adopt the current defaults (for example an updated built-in system prompt), use the settings page's **Restore default configuration** action: like a skill update it overwrites the existing configuration — custom system prompt, tool list, model/compaction settings and MCP Servers — keeping only `name`, `description` and `version`.

### System prompt placeholders

`system_prompt` is the only template with placeholder substitution. Available placeholders:

| Placeholder | Injected content |
| --- | --- |
| `{{AGENTS_MD}}` | Full text of `AGENTS.md` |
| `{{VAULT_KEYS}}` | List of Vault key names (names only) |
| `{{SKILL_METADATA}}` | Metadata of installed Skills |
| `{{MEMORY}}` | The rendered `memory.prompt` block (its `[workspace_memory]` region kept only in a persistent Workspace); empty when Memory is off. A template without it injects no Memory — the Memory tab offers inserting it explicitly |
| `{{MEMORY_USER_DIR}}` | Inside the Memory prompt: absolute path of the user memory directory |
| `{{MEMORY_USER_INDEX}}` | Inside the Memory prompt: content of the user scope's `MEMORY.md` index (capped at 200 lines) |
| `{{MEMORY_DIR}}` | Inside the `[workspace_memory]` region: the current Workspace's memory directory |
| `{{MEMORY_INDEX}}` | Inside the `[workspace_memory]` region: content of the Workspace scope's `MEMORY.md` index (capped at 200 lines) |
| `{{PLATFORM}}` | Runtime platform |
| `{{OS_VERSION}}` | Operating system version |
| `{{DATE}}` | Current date |
| `{{PROJECT_DIR}}` | App Data Dir: the PenguinHarness app data root (the Project directory) |
| `{{AGENT_ID}}` | Agent id |
| `{{CWD}}` | Workspace path |
| `{{PROVIDER}}` | Model provider group |
| `{{MODEL_ID}}` | Upstream model id |
| `{{SESSION_ID}}` | Session id |

`{{PROJECT_DIR}}` is surfaced to the model as the **App Data Dir**: PenguinHarness's application data root, holding every Agent's data files (`agents/<agent_id>/…`) and the project-level data — deliberately not described as a project or task directory, so the model does not mistake it for the task's working directory (`CWD`).

On Windows, `{{PROJECT_DIR}}` and `{{CWD}}` are injected with forward slashes — like every other path core composes for the model (attachment lines, the goal-file line, truncated-output recovery paths). The model re-emits these spellings into JSON tool arguments and shell commands; forward slashes are accepted by Node's fs APIs and the package's (Git) Bash tool shell, and avoid JSON backslash-escaping mistakes.

`agent_state/AGENTS.md` is the developer-editable instruction file, injected via `{{AGENTS_MD}}` and empty by default — it is also the file an optimizer edits most (see [Self-Improvement](/self-improvement)).

## Memory

`agent_state/memory/` is what the Agent remembers between Sessions: user feedback, project decisions, working conventions and entry points into external systems — the things that cannot be re-derived from the Workspace or its code history. It is not context compaction, which preserves one Session's short-term state.

Memory has two scopes, both belonging to one Agent and never shared with another:

- **User scope** (`memory/user/`) — what stays true wherever the Agent works: who the user is, their standing preferences, reference material not tied to one codebase. Every Session reads it, including one running in a temporary Workspace, which has no other place to write.
- **Workspace scope** (`memory/<workspace_key>/`) — facts about one Workspace. Sessions of one Agent in one Workspace share it; different Workspaces keep their topic files apart.

Each scope carries its own `MEMORY.md` index, and different Agents never share Memory even in the same Workspace. Because Memory lives in Agent State it travels with export / import and snapshots, and every Project member who can reach the Agent can read it — so credentials and sensitive personal data never belong in it.

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

`user` is a reserved directory name, safe because every generated workspace key is `<base>-<8 hex>` and therefore always carries a hyphen — a hyphen-free name can never be produced.

The workspace key is `<safe-basename>-<8 hex of the real path's sha256>`. Identity is the directory itself and has nothing to do with Git: two symlinks to one directory resolve to one key, while moving or renaming a directory makes it a new Workspace (the old Memory stays on disk under the old key). A temporary Workspace — one PenguinHarness allocated under `agents/<agent_id>/workspaces/` — gets no Workspace scope at all, a subagent inheriting one included: a temporary Workspace is allocated per Session, so no later Session would ever run there to read it back. Such a Session still gets the user scope, which is where anything it learns belongs anyway.

A topic file is a semantic subject, not one per Task, Session or date, and carries frontmatter:

```markdown
---
name: testing-conventions
description: the project's test environment and verification rules
type: feedback
updated_at: 2026-08-07
---

- Integration tests connect to a real database; no mock repositories.
```

`type` is `user` (who the user is — role, expertise, standing preferences; the user scope's type), `feedback` (how the user wants the Agent to work, with the why), `project` (decisions, constraints and plans with their reasons) or `reference` (stable entry points into external systems, documents and services). A topic that turns out to be wrong is deleted together with its index line, and dates are written absolute (`YYYY-MM-DD`) — relative ones mean nothing to a later Session. What must never be saved: facts the code, config or Git history already states; short-lived task progress and debugging notes; credentials, tokens or secrets; unconfirmed guesses; long transcript excerpts.

Each `MEMORY.md` lists its scope's memories one line each — `- [Title](file.md) — hook`, links relative to the scope directory — and is updated in the same round as the file, so the two never disagree.

Only the indexes reach the context, through the template's `{{MEMORY}}` placeholder. It expands to `memory.prompt` — what Memory is for, the save mechanics, and both scopes with their indexes, carrying `{{MEMORY_USER_DIR}}` / `{{MEMORY_USER_INDEX}}` and, inside its `[workspace_memory]` … `[/workspace_memory]` region, `{{MEMORY_DIR}}` / `{{MEMORY_INDEX}}`. The prompt is per-Agent config, editable on the settings page's Memory tab. Injected index content is fenced by `[user_memory_index]` / `[workspace_memory_index]` marker pairs so the model can tell it from instruction; a blank index injects an explicit "nothing saved yet" note, and injection is capped at 200 lines per scope (one memory per line by convention) — past the cap a truncation note tells the model to open the full `MEMORY.md` itself, and the file on disk is never touched. Topic bodies are read on demand by the model.

The `[workspace_memory]` region is the prompt's one conditional part: in a persistent Workspace its content is kept (the markers stripped), in a temporary Workspace the whole region is removed — such a Session is never told about a directory it does not have, which is also why the scope-choice rule lives inside the region. The Harness only decides where Memory lives and keeps writes inside it — deciding what is worth keeping, splitting topics and maintaining the indexes is the model's job, done with the ordinary file tools.

A template without `{{MEMORY}}` injects no Memory — an Agent created before Memory shipped, for instance. The Memory tab reports this and offers inserting the placeholder (before `# Environment`) as an explicit one-click action; nothing is ever spliced in automatically. The assembled prompt is recorded in `session_meta`.

To read, delete or ask the Agent to edit what it has saved, use the settings page's [Memory tab](/web-app#agent-settings-agents).

## Vault

`agent_state/.vault.toml` is the Agent-level environment-variable vault: a hidden file written with mode 0600.

- Key names must match `^[A-Za-z_][A-Za-z0-9_]*$` (shell environment variable naming rules);
- Values are injected only into tool subprocess environments and never enter the model context or the Trace;
- Only key names are disclosed in the system prompt via `{{VAULT_KEYS}}`;
- Saving through the Web/API invalidates the Agent's cached Session runtimes: the next Task on any of its Sessions re-resumes and runs with the new values; a Task already in flight keeps the values it started with (a direct CLI file edit reaches a running server only when a Session is next created or resumed);
- Managed via `penguin config vault set/list/remove` or the Web Vault tab.

## Schedules

Each file `agent_state/schedule/<name>.toml` describes one scheduled task (the filename is its identity) that sends a preset Prompt to the Agent on a cadence. Schedules execute only while the Web service (the server runtime) is running, and are managed in the Web Agent settings → Schedule tab.

| Field | Required | Description |
| --- | --- | --- |
| `prompt` | yes | The Prompt sent on each trigger |
| `enabled` | no | Enabled switch; defaults to `false` |
| `start_at` | yes | First trigger time (ISO 8601) |
| `period` | no | Cadence such as `30m` / `12h` / `7d`, minimum 5 minutes; omitted means a one-shot task |
| `end_at` | no | End time; must be later than `start_at` |
| `session_id` | no | Bind to an existing Session; mutually exclusive with the three fields below |
| `workspace` | no | Workspace for new-Session mode |
| `provider` / `model_id` | no | Paired model reference for new-Session mode; write both or neither — a lone `model_id` is rejected, and with neither the Project's default model is used |

```toml
prompt = "Check yesterday's builds and summarize the failures"
enabled = true
start_at = 2026-08-01T09:00:00Z
period = "12h"
```

## Design principle

An Agent's behavior lives entirely in editable files on disk — prompts, Skills, and configuration are data, not code. That is what makes Agents improvable by Agents: an optimizer edits exactly the same files you edit by hand. See [Self-Improvement](/self-improvement) and the [CLI Reference](/cli).
