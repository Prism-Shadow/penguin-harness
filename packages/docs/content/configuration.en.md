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

When a model entry has no inline `api_key`, AgentHub falls back to the provider's environment variable. A `*_BASE_URL` value is used only when the entry does not already inline `base_url`:

| Provider | API key | Base URL |
| --- | --- | --- |
| deepseek | `DEEPSEEK_API_KEY` | `DEEPSEEK_BASE_URL` |
| anthropic | `ANTHROPIC_API_KEY` | `ANTHROPIC_BASE_URL` |
| openai, openrouter, fireworks, siliconflow, qwen-token-plan, qwen-pay-as-you-go, custom | `OPENAI_API_KEY` | `OPENAI_BASE_URL` |
| minimax | `MINIMAX_API_KEY` | `MINIMAX_BASE_URL` |
| google | `GEMINI_API_KEY` | `GEMINI_BASE_URL` |
| zhipu | `ZAI_API_KEY` | `ZAI_BASE_URL` |
| moonshot | `MOONSHOT_API_KEY` | `MOONSHOT_BASE_URL` |

The openrouter, fireworks, siliconflow, qwen-token-plan, qwen-pay-as-you-go, and custom groups speak the OpenAI-compatible protocol, hence the shared `OPENAI_*` variables. The direct MiniMax M3 Responses client uses `MINIMAX_*`; the built-in MiniMax preset already pins the official endpoint. Provider groups and the built-in model catalog are covered in [Models & Providers](/models).

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
| `client_type` | AgentHub client protocol; inferred from `model_id` by default — custom endpoints use a generic protocol client: `openai-responses`, `ant-messages`, or `openai-chat` (the Web dialog can detect which one a base URL serves; the pre-0.4.2 `openai` spelling is a deprecated alias of `openai-chat`, normalized on read) |
| `display_name` | Display name; persisted only when it differs from the built-in catalog |
| `vision` | Whether image input is supported; defaults to supported |
| `max_tokens` | Per-model max output tokens; overrides the Agent's `model.max_tokens` when set, omitted = inherit it |
| `fast_mode` | Per-model fast mode (premium faster serving tier); off by default, only `true` is persisted. Offered only for models whose AgentHub client can serve it; the others reject requests carrying it — see [Models](/models#fast-mode) |
| `pricing` | Three price buckets `cache_read` / `cache_write` / `output`, in USD per million Tokens (`unit = "usd_per_mtok"`) |
| `api_key` | Inline credential; when empty, falls back to the provider environment variable |
| `base_url` | Custom base URL; preset by the built-in catalog for gateways and direct MiniMax models |
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
| `kernel_version` | current kernel version | Config kernel version (a date string): which generation of the built-in defaults this config is based on, stamped at creation, restore-defaults and kernel update; unrelated to `version`, never changed by user edits; missing = predates the mechanism (i.e. outdated) |
| `system_prompt` | built-in template | Required; the only template with placeholder substitution |
| `max_turns` | `-1` | Maximum LLM turns per Task (`-1` = unlimited; a positive integer caps the Task) |
| `model.max_tokens` | `32000` | Output Token ceiling per Request (-1 = no cap, provider default); each request clamps the effective value to the model's `context_window` minus the estimated input, so a small-window model never gets asked for more than fits |
| `model.thinking_level` | `medium` | `none` / `low` / `medium` / `high` / `xhigh`; the session default, overridable per-Task |
| `model.timeoutMs` | `120000` | Per-Request timeout (milliseconds) |
| `compaction.max_context_length` | `128000` | Context Token threshold that triggers compaction; the effective threshold is capped at the model's `context_window` − 2048 so compaction fires before a small window overflows |
| `compaction.max_session_turns` | `-1` | Cumulative Session turn threshold (`-1` = unlimited) |
| `compaction.mode` | `summarize` | `summarize` / `discard` |
| `compaction.prompt` | built-in template | Prompt used for summarize compaction |
| `memory.enabled` | `true` | Whether Memory enters the context and Memory directories are prepared |
| `memory.prompt` | built-in template | Always-injected half of the `{{MEMORY}}` block, editable on the Memory tab — carries `{{USER_MEMORY_INDEX}}` |
| `memory.workspace_prompt` | built-in template | Appended only in a persistent Workspace, editable on the Memory tab — carries `{{WORKSPACE_MEMORY_INDEX}}` and `{{WORKSPACE_MEMORY_DIR}}` |
| `vault.enabled` | `true` | Whether the vault section enters the context (with it off, values are still injected into subprocess environments — the model just doesn't see the key-name list) |
| `vault.prompt` | built-in template | The `{{VAULT}}` block, editable on the Vault tab — carries `{{VAULT_KEYS}}` |
| `skills.enabled` | `true` | Whether the skills section enters the context (with it off, installed skills remain explicitly invocable via `[use_skills]`) |
| `skills.prompt` | built-in template | The `{{SKILLS}}` block, editable on the Skills tab — carries `{{SKILL_METADATA}}` |
| `schedules.enabled` | `true` | Whether the scheduled-tasks section enters the context (with it off, the server still fires tasks — the model just isn't taught the task system) |
| `schedules.prompt` | built-in template | The `{{SCHEDULES}}` block, editable on the Schedules tab — teaches the model file-based task management, carries `{{SCHEDULE_LIST}}` |
| `tools.builtin` | full default toolset when omitted | Tool entries: `name` / `description` / `parameters` / `permission` (`r` or `rw`) / `forModel` / `timeoutMs` / `maxOutputLength` / `call_description` (per-tool toggle for the `description` call argument, required while on; missing = kept); once written it replaces the default list wholesale |
| `tools.mcpServers` | `[]` | MCP Server configuration (`name` + `config`): transport is `stdio` / `http` / `sse`, and discovered tools join the toolset as `mcp__<server>__<tool>`; see the MCP Servers section of [Tools & Approval](/tools) |

Tool permissions and approval semantics are covered in [Tools & Approval](/tools).

A partial-override example (edit the file the init step generated). Note that this file is **not deep-merged with the defaults**: a key you write out takes effect wholesale, and only omitted keys fall back to the defaults above at their use sites; `system_prompt` is required (loading refuses without it), so keep the full generated template when editing other fields:

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
  timeoutMs: 120000

compaction:
  max_context_length: 128000
  max_session_turns: -1
  mode: summarize

# Omitting the whole tools section = the full default toolset. Writing tools.builtin
# REPLACES the default list wholesale: carry the complete definition (including the
# parameters JSON Schema) for every tool you keep — see Tools & Approval.
```

An existing Agent always runs with its on-disk config verbatim — newer code defaults are never merged in automatically. When the built-in defaults change substantively, the config's `kernel_version` falls behind the current kernel and the settings page and agents list show an update hint. Two paths adopt the current defaults (side by side on the settings overview):

- **Update kernel**: a lossless merge. Field by field: a missing field, or one still equal to a *recorded* generation's built-in default, follows the current default; a user-edited field stays unchanged and is listed in the result. `tools.builtin` merges per tool name — only the edited tool is kept, the rest follow, and user-added entries are untouched; `name`, `description`, `version` and `tools.mcpServers` are never touched. The config is then stamped with the current `kernel_version`. Matching is **conservative**: only values whose hash hits a recorded generation count as old defaults — generations too old to reconstruct are kept as if customized.
- **Restore default configuration**: like a skill update, overwrites the existing configuration with the current defaults — custom system prompt, tool list, model/compaction settings and MCP Servers — keeping only `name`, `description` and `version`. The full-refresh fallback when the kernel update's conservative matching leaves fields behind.

For developers: `kernel_version` advances manually, and only on a substantive change to the built-in defaults (using that day's date). The pinned-hash test in CI (`core/test/kernel-version.test.ts`) recomputes every default leaf hash against the latest `kernel-history.ts` entry and fails on drift, telling you to bump `KERNEL_VERSION` and append a new entry; several changes on the same day may revise that day's entry, while older entries are frozen forever — they are what identifies "still the old default".

### System prompt placeholders

`system_prompt` is the only template with placeholder substitution. Available placeholders:

| Placeholder | Injected content |
| --- | --- |
| `{{AGENTS_MD}}` | Full text of `AGENTS.md` |
| `{{VAULT}}` | The rendered `vault.prompt` block (the vault section); empty when `vault.enabled` is off. A template without it injects no vault section — the Vault tab offers inserting/migrating it explicitly |
| `{{SKILLS}}` | The rendered `skills.prompt` block (the skills section); empty when `skills.enabled` is off. A template without it injects no skills section — the Skills tab offers inserting/migrating it explicitly |
| `{{MEMORY}}` | The rendered `memory.prompt` block, plus `memory.workspace_prompt` in a persistent Workspace; empty when Memory is off. A template without it injects no Memory — the Memory tab offers inserting it explicitly |
| `{{SCHEDULES}}` | The rendered `schedules.prompt` block (the scheduled-tasks section); empty when `schedules.enabled` is off. A template without it injects no schedules section — the Schedules tab offers inserting it explicitly |
| `{{VAULT_KEYS}}` | Inside `vault.prompt`: the Vault key-name list (names only, one `- KEY` line per key). For legacy templates, an occurrence directly in the template body is still substituted, honoring `vault.enabled` the same way |
| `{{SKILL_METADATA}}` | Inside `skills.prompt`: the installed Skills' metadata lines. For legacy templates, an occurrence directly in the template body is still substituted, honoring `skills.enabled` the same way |
| `{{SCHEDULE_LIST}}` | Inside `schedules.prompt`: the current task-name list (one `- name` line per task; an empty-roster note when none exist) |
| `{{USER_MEMORY_INDEX}}` | Inside the Memory prompts: content of the user scope's `MEMORY.md` index (at most 200 lines and 25,000 characters total) |
| `{{WORKSPACE_MEMORY_INDEX}}` | Inside `memory.workspace_prompt` only: content of the Workspace scope's `MEMORY.md` index (at most 200 lines and 25,000 characters total) |
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

`{{PROJECT_DIR}}` is surfaced to the model as the **App Data Dir**: PenguinHarness's application data root, holding every Agent's data files (`agents/<agent_id>/…`) and the project-level data — deliberately not described as a project or task directory, so the model does not mistake it for the task's working directory (`CWD`).

On Windows, `{{PROJECT_DIR}}` and `{{CWD}}` are injected with forward slashes — like every other path core composes for the model (attachment lines, the goal-file line, truncated-output recovery paths). The model re-emits these spellings into JSON tool arguments and shell commands; forward slashes are accepted by Node's fs APIs and the package's (Git) Bash tool shell, and avoid JSON backslash-escaping mistakes.

`agent_state/AGENTS.md` is the developer-editable instruction file, injected via `{{AGENTS_MD}}` and empty by default — it is also the file an optimizer edits most (see [Self-Improvement](/self-improvement)).

The Vault / Skills / Memory / Schedules sections all follow the same placeholder + toggle + editable prompt pattern: the template holds only the `{{VAULT}}` / `{{SKILLS}}` / `{{MEMORY}}` / `{{SCHEDULES}}` placeholders, the section text lives in the corresponding `*.prompt` config (edited on its settings tab), and turning `*.enabled` off empties the whole block. The four section placeholders are expanded **last, in a single pass** at assembly time: expansion products are never rescanned, so placeholder-looking text inside a memory index or a section prompt stays literal instead of triggering a second substitution.

**Legacy templates**: `system_config.yaml` is materialized at Agent creation and never auto-upgraded, so an Agent created before this mechanism carries hardcoded `# Vault` / `# Skills` section text with inline `{{VAULT_KEYS}}` / `{{SKILL_METADATA}}` in its template. Such templates keep working: the inline placeholders are still substituted, and now honor the new toggles (an off switch substitutes an empty string). The matching tab reports the legacy template and offers one-click migration — replacing the old default section verbatim, in place, with the new placeholder, leaving the assembled prompt unchanged; a template whose section text was customized doesn't match the verbatim migration and is treated as missing the placeholder instead, with a one-click insert (before `# Environment`).

## Memory

`agent_state/memory/` is what the Agent remembers between Sessions: user feedback, project decisions, working conventions and entry points into external systems — the things that cannot be re-derived from the Workspace or its code history. It is not context compaction, which preserves one Session's short-term state.

Memory has two scopes, both belonging to one Agent and never shared with another:

- **User scope** (`memory/user/`) — what stays true wherever the Agent works: who the user is, their standing preferences, reference material not tied to one codebase. Every Session reads it, including one running in a temporary Workspace, which has no other place to write.
- **Workspace scope** (`memory/<workspace_memory_key>/`) — facts about one Workspace. Sessions of one Agent in one Workspace share it; different Workspaces keep their topic files apart.

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

`user` is a reserved directory name, safe because every generated workspace memory key is `<base>-<8 hex>` and therefore always carries a hyphen — a hyphen-free name can never be produced.

The workspace memory key is `<safe-basename>-<8 hex of the real path's sha256>`. Identity is the directory itself and has nothing to do with Git: two symlinks to one directory resolve to one key, while moving or renaming a directory makes it a new Workspace (the old Memory stays on disk under the old key). A temporary Workspace — one PenguinHarness allocated under `agents/<agent_id>/workspaces/` — gets no Workspace scope at all, a subagent inheriting one included: a temporary Workspace is allocated per Session, so no later Session would ever run there to read it back. Such a Session still gets the user scope, which is where anything it learns belongs anyway.

A topic file is a semantic subject, not one per Task, Session or date, and carries frontmatter:

```markdown
---
name: testing-conventions
description: the project's test environment and verification rules
updated_at: 2026-08-07
---

- Integration tests connect to a real database; no mock repositories.
```

These three fields are all the frontmatter there is — which layer a memory belongs to is expressed by its directory, so there is no `type` field (a `type:` line left in an earlier file is ignored as an unknown field). Worth saving: who the user is (role, expertise, standing preferences) and how they want the Agent to work, with the why; decisions, constraints and plans not derivable from the code; stable entry points into external systems, documents and services. A topic that turns out to be wrong is deleted together with its index line, and dates are written absolute (`YYYY-MM-DD`) — relative ones mean nothing to a later Session. What must never be saved: facts the code, config or Git history already states; short-lived task progress and debugging notes; credentials, tokens or secrets; unconfirmed guesses; long transcript excerpts.

Each `MEMORY.md` lists its scope's memories one line each — `- [Title](file.md) — hook`, links relative to the scope directory — and is updated in the same round as the file, so the two never disagree.

Only the indexes reach the context, through the template's `{{MEMORY}}` placeholder. It expands to `memory.prompt` — what Memory is for, the save mechanics, then a `## User memory` section with its index (`{{USER_MEMORY_INDEX}}`) — plus `memory.workspace_prompt`, a `## Workspace memory` section with `{{WORKSPACE_MEMORY_INDEX}}`, when the Session runs in a persistent Workspace. Both prompts are per-Agent config, editable on the settings page's Memory tab, and organized by Markdown headings like the template's other sections. The `User Memory Dir` line is the literal pattern `<app_data_dir>/agents/<agent_id>/agent_state/memory/user`, resolvable from the Environment section; the `Workspace Memory Dir` line renders resolved via `{{WORKSPACE_MEMORY_DIR}}`, because its final segment — the workspace memory key — is a path hash the model could never compose itself.

A blank index injects an explicit "nothing saved yet" note. Injection is capped at 200 lines per scope (one memory per line by convention), then at 25,000 characters total as a backstop for indexes whose few lines are enormous — past a cap a truncation note tells the model to open the full `MEMORY.md` itself, and the file on disk is never touched. The default Memory prompt declares the line cap and asks for index lines under ~150 characters, so the model keeps the index short before ever hitting the caps; the character backstop lives only in code. Topic bodies are read on demand by the model.

The two halves are separate config keys because substitution has no conditionals: a temporary Workspace must never be handed the Workspace section (its directory line and the scope-choice rule), so that half is simply not appended there. The Harness only decides where Memory lives and keeps writes inside it — deciding what is worth keeping, splitting topics and maintaining the indexes is the model's job, done with the ordinary file tools.

A template without `{{MEMORY}}` injects no Memory — an Agent created before Memory shipped, for instance. The Memory tab reports this and offers inserting the placeholder (before `# Environment`, the position the default template gives it) as an explicit one-click action; nothing is ever spliced in automatically. The assembled prompt is recorded in `session_meta`.

To read, delete or ask the Agent to edit what it has saved, use the settings page's [Memory tab](/web-app#agent-settings-agents).

## Vault

`agent_state/.vault.toml` is the Agent-level environment-variable vault: a hidden file written with mode 0600.

- Key names must match `^[A-Za-z_][A-Za-z0-9_]*$` (shell environment variable naming rules);
- Values are injected only into tool subprocess environments and never enter the model context or the Trace;
- Only key names are disclosed in the system prompt: the template's `{{VAULT}}` placeholder expands to `vault.prompt` (carrying the `{{VAULT_KEYS}}` key-name list), editable on the Vault tab; with `vault.enabled` off the block is empty — values are still injected into subprocesses, the model just doesn't see the key-name list. A legacy template's inline `{{VAULT_KEYS}}` is still substituted under the same toggle, and the tab offers one-click migration (see "System prompt placeholders");
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

The template's `{{SCHEDULES}}` placeholder expands to `schedules.prompt`: it teaches the model to manage these TOML files with its own file tools (the directory, the field rules, the ~30-second automatic pickup, and the hygiene rules against duplicates), ending with the current task-name list via `{{SCHEDULE_LIST}}`. The prompt is editable on the Schedules tab; with `schedules.enabled` off the block is empty — the server still fires tasks on schedule, the model just isn't taught the task system. An Agent created before this mechanism has no such placeholder in its template; the tab offers one-click insertion.

## Design principle

An Agent's behavior lives entirely in editable files on disk — prompts, Skills, and configuration are data, not code. That is what makes Agents improvable by Agents: an optimizer edits exactly the same files you edit by hand. See [Self-Improvement](/self-improvement) and the [CLI Reference](/cli).
