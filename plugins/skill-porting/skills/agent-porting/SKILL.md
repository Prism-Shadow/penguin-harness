---
name: agent-porting
description: Migrate an agent into PenguinHarness from Claude Code, Codex, DeepSeek Harness (dsh), Qoder, Qwen Code, WorkBuddy, Pi or another coding agent — read its instructions, skills, commands, subagents, MCP servers, hooks and memory without copying a secret, write them as an Agent zip folder (a manifest.json with a definition, plus agent_state/), create the agent with `penguin agent import`, and report what did not move.
version: 2026.11.05.2
---

# Agent Porting

An agent set up in another coding tool is a handful of files: instructions, skills, slash commands, subagent definitions, MCP servers, hooks, notes the tool wrote to itself. This skill reads those files, writes them in the layout of a PenguinHarness Agent zip, and creates a **new** Agent from it in the current Project with `penguin agent import`. The source is never changed, and no secret value travels: credentials become Vault key names that the user fills in afterwards.

To bring in a few skills to the current Agent instead, use `skill-porting`; to turn another tool's plugin into a server-wide plugin package, use `plugin-porting`. Both sit beside this skill.

## Before you start

- If the message only invokes this skill without naming a source, ask which tool the agent comes from, where its files are (the default user directory, a project folder, or both), and, when the tool has subagents, which one is meant. Read nothing until that is clear. When the message names a tool or a path (the prompt that **Import agent** 「导入 Agent」 → **Migrate from another framework** 「从其他框架迁移」 on the Agents page opens does), go ahead and list your assumptions in the final reply.
- Paths are on the machine you run on, which is the server's. When the source lives on another computer, ask the user to copy it here first.
- Pick the new Agent's id: 2–64 characters, a lowercase letter first, then lowercase letters, digits and `_` (no hyphens). Check `penguin agent ls --project-id <project>` for a collision. The Project is the one the prompt names; without one, ask.
- Build the folder in this Session's scratchpad (`<app_data_dir>/agents/<agent_id>/scratchpad/<session_id>/`), at `<scratchpad>/agent-port/<id>/`, called `<port>` below: it is an intermediate, not a deliverable. Use absolute paths, since each command starts in the Workspace.
- `<inspect>` below is the reader that ships with this skill: `node <app_data_dir>/agents/<agent_id>/agent_state/skills/agent-porting/scripts/inspect-config.mjs`. It is the only way any source file is read (step 1).
- Keep the conversation small: list trees with `ls -la` and `find <dir> -maxdepth 3 -type f -not -name '*.jsonl'` (which leaves transcripts out), and read a long file in parts with `--lines <from>-<to>`.

## 1. Read the source, all of it

Read the files themselves, not a summary, and read what they point at: an `@path` import, a file a rule or a command names, every script a skill or hook runs. User-level files come first, then the project's. Never invent a layout that is not on disk: when a directory below is missing, say so and move on; when nothing is there at all, ask.

The layouts below were checked against each tool's own documentation on 2026-11-04. A tool may have moved things since: when a path is not where this says, list the tool's directory and map by shape.

**A secret value never enters this conversation.** Everything a command prints becomes part of this Session's Trace, which is stored, sent to the model, and may later travel in an export. So every source file is read through `<inspect>`, and no other command (`cat`, `sed`, `head`, `grep`, `jq`, an editor) ever reads one:

- **Scan first.** Run `<inspect> --scan <dir>` on each source directory before reading anything in it: the tool's home (`~/.claude`, `~/.codex`, …; transcripts and caches are skipped), the project's tool folder, and the instruction files themselves. It prints `file:line: <kind>` for each line that looks like it holds a credential, and never the line.
- **Configuration** (JSON, TOML, YAML: `settings*.json`, `~/.claude.json`, `.mcp.json`, `mcp.json`, `hooks.json`, `config.toml`, `cordis.patch.yml`, `models.json`, a TOML command or agent file): `<inspect> <file>...` prints the file as JSON by allowlist. Key names, numbers and booleans print. A string prints only when it is a `${VAR}` / `${credential:…}` reference, the value of a structural key (`name`, `type`, `transport`, `command`, `cwd`, `matcher`, `model`, effort and approval settings, …), an `args` flag or package or path, or a URL's scheme, host and path; everything else prints as `<redacted:N chars>`. A `command` holding a shell line prints its program and a word count. Under a key that names a credential (`*token*`, `*key*`, `Authorization`, …) even a reference shows only its structure, `Bearer ${<redacted:N chars>}`. `--only mcpServers,hooks` narrows the output; a file that does not parse prints its key names only.
- **Text** (instructions, rules, skills, commands, subagents, scripts, any supporting file): `<inspect> --show <file>`, which prints it with each flagged line replaced whole by `<redacted line: kind>`. A subagent's or skill's frontmatter can hold `mcpServers` with literal `env` values; `--show` masks such a line like any other.
- **Never at all**: the files in each tool's "never" line, transcripts and history (`*.jsonl` session logs), and credential stores (`.env`, `*.env`, `.envrc`, `auth.json`, `*credentials*`, `*tokens*.json`, `*.pem`, `*.key`, `id_rsa*`, `.netrc`, `.npmrc`, `.pypirc`). The reader refuses them.

What the reader keeps back is what you never need: a value is mapped by its name and its place, never by its content.

### Claude Code

Home `~/.claude/` (or `$CLAUDE_CONFIG_DIR`); project files at the repository root and in its `.claude/`.

- **Instructions**: `~/.claude/CLAUDE.md`, `~/.claude/rules/**/*.md`; project `CLAUDE.md` or `.claude/CLAUDE.md`, `CLAUDE.local.md`, `.claude/rules/**/*.md` (a rule's `paths:` frontmatter limits it to matching files). A project `AGENTS.md` is read when no `CLAUDE.md` exists. Nested `CLAUDE.md` files in subdirectories load when Claude works there.
- **Skills**: `~/.claude/skills/<name>/SKILL.md`, `.claude/skills/<name>/`.
- **Commands**: `~/.claude/commands/**/*.md`, `.claude/commands/` — `$ARGUMENTS`, `$ARGUMENTS[N]`, `$N` (0-based) and `$<name>` from the `arguments` frontmatter.
- **Subagents**: `~/.claude/agents/*.md`, `.claude/agents/*.md` — frontmatter `name`, `description`, `tools`, `disallowedTools`, `model`, `effort`, `permissionMode`, `skills`, `mcpServers`, `hooks`, `memory`; the body is the subagent's prompt. Their memory: `~/.claude/agent-memory/<name>/`, `.claude/agent-memory/<name>/`.
- **MCP**: `~/.claude.json` top-level `mcpServers` (user scope) and `projects["<absolute path>"].mcpServers` (local scope); `.mcp.json` at the project root. An entry has `type` (`stdio`, `http`, `sse`), `command`, `args`, `env`, `url`, `headers`; values may hold `${VAR}` or `${VAR:-default}`. Read `~/.claude.json` only as `<inspect> ~/.claude.json`: it prints these servers and nothing of the account state around them.
- **Hooks**: `hooks` in `~/.claude/settings.json`, `.claude/settings.json` and `.claude/settings.local.json`: event → `[{ matcher, hooks: [{ type, command, timeout }] }]`, with `type` one of `command`, `http`, `mcp_tool`, `prompt`, `agent`.
- **Settings**: `model`, `effortLevel`, `permissions` (`allow` / `ask` / `deny`, `defaultMode`), `env` (names only); output styles in `output-styles/*.md`.
- **Memory**: `~/.claude/projects/<project>/memory/MEMORY.md` plus topic files (`<project>` is the repository path with every non-alphanumeric character turned into `-`; `autoMemoryDirectory` in settings moves it).
- **Also there**: installed plugins under `~/.claude/plugins/`, workflow scripts in `workflows/*.js`.
- **Never**: `~/.claude/.credentials.json`, `projects/<project>/*.jsonl`, `history.jsonl`, `file-history/`, `apiKeyHelper` output.

### Codex

Home `~/.codex/` (or `$CODEX_HOME`); project `.codex/` in a trusted repository.

- **Instructions**: `~/.codex/AGENTS.override.md`, else `~/.codex/AGENTS.md`; then in each directory from the repository root down to the working directory, `AGENTS.override.md`, else `AGENTS.md`, else a name listed in `project_doc_fallback_filenames` — one file per directory, root first.
- **Skills**: `~/.agents/skills/<name>/`, `.agents/skills/` in the working directory and each parent up to the repository root, `/etc/codex/skills/`. A skill may carry `agents/openai.yaml` (display metadata, invocation policy, tool dependencies). Skip a skill that `[[skills.config]]` in `config.toml` sets to `enabled = false`.
- **Prompts**: `~/.codex/prompts/*.md`, top level only (deprecated in favour of skills) — `$1`…`$9`, `$ARGUMENTS`, named `$FILE` (given as `FILE=value`), `$$` for a literal `$`.
- **Subagents**: `~/.codex/agents/*.toml`, `.codex/agents/*.toml`, one agent per file — `name`, `description`, `developer_instructions` (its prompt), optional `model` and `model_reasoning_effort`; roles may also be declared as `[agents.<name>]` in `config.toml`, with a `description` and a `config_file` (a TOML layer, relative to the declaring file).
- **MCP**: `[mcp_servers.<name>]` in `~/.codex/config.toml` and `.codex/config.toml` (and inside `[profiles.<name>]`): `command`, `args`, `env`, `env_vars`, `cwd` for stdio; `url`, `bearer_token_env_var`, `http_headers`, `env_http_headers` for streamable HTTP.
- **Hooks**: `~/.codex/hooks.json`, `.codex/hooks.json`, or an inline `[hooks]` table in either `config.toml`: event → `[{ matcher, hooks: [{ type, command, timeout }] }]`, `timeout` in seconds; only `command` and `mcp_tool` handlers run.
- **Settings**: `model`, `model_provider`, `model_reasoning_effort`, `approval_policy`, `sandbox_mode`.
- **Memory**: `memories/` or `memories_v2/` is generated state, not notes to carry: report it.
- **Never**: `auth.json`, the keyring store, the value of any variable an `env_key` names, `sessions/`, `history.jsonl`. The reader masks `experimental_bearer_token` and `oauth.client_secret` in `config.toml`.

### DeepSeek Harness (`dsh`)

Home `~/.dsh/` (or `$DSH_HOME`); a shared root `~/.agents/` (or `$DSH_AGENTS_HOME`); project `.dsh/` and `.agents/`.

- **Instructions**: `~/.dsh/AGENTS.md` and `~/.agents/AGENTS.md`; then in each directory from the project root (the one holding `.git`) down to the working directory, `AGENTS.md` and `CLAUDE.md`, followed by the local overlays `AGENTS.local.md` and `CLAUDE.local.md`.
- **Skills**: `.dsh/skills/`, `.agents/skills/`, `~/.dsh/skills/`, `~/.agents/skills/` — directory skills (`<name>/SKILL.md`) and flat Markdown skills (`<name>.md`).
- **Configuration**: Cordis patch layers, `~/.dsh/cordis.patch.yml` (every profile) and `~/.dsh/profiles/<name>/cordis.patch.yml` (one profile, with a `package.json` listing its plugins). Each row names a plugin and its `config`.
- **MCP**: rows named `@deepseek-ai/dsh-mcp-client` (`config.serverName`, `transport` `stdio` or `streamable-http`, `command`, `args`, `env`, `cwd`, `url`, `headers`) and the `@deepseek-ai/dsh-mcp-manager` row's `config.servers.<serverName>` (the same fields plus `enabled`). Values may hold `${credential:<name>}`.
- **Hooks**: no format of its own. A `@deepseek-ai/dsh-hooks-claude-code` or `@deepseek-ai/dsh-hooks-codex` row's `configPath` names a Claude Code `hooks.json` or settings file, or a Codex `hooks.json`: read that file and map it as for that tool.
- **Subagents, commands, memory**: no files of their own. Agent presets, personas and command plugins are Cordis rows: report them. Memory comes from optional MCP server rows, which map as MCP servers (their data stays with that server).
- **Never**: `~/.dsh/.credentials.yaml`, `~/.dsh/cache/`, account state.

### Qoder CLI

Home `~/.qoder/` (or `$QODER_CONFIG_DIR`); project `.qoder/`.

- **Instructions**: `~/.qoder/AGENTS.md`, `~/.qoder/rules/**/*.md`; in each directory from the working directory up to the repository root, `AGENTS.md`, `AGENTS.local.md` and `.qoder/rules/**/*.md`.
- **Skills**: `~/.qoder/skills/<name>/SKILL.md`, `.qoder/skills/`.
- **Commands**: `~/.qoder/commands/<name>.md`, `.qoder/commands/` (frontmatter `description`, optional `name`). The argument syntax is undocumented: read each body for a placeholder.
- **Subagents**: `~/.qoder/agents/*.md`, `.qoder/agents/*.md` — frontmatter `name`, `description`, `tools`, `disallowedTools`, `model`, `permissionMode`, `effort`, `skills`, `mcpServers`, `hooks`, `memory`.
- **MCP**: `mcpServers` in `~/.qoder/settings.json`, `.qoder/settings.json`, `.qoder/settings.local.json`, and the project's `.mcp.json`: `command`, `args`, `env`, `cwd`; `type: "sse"` or `"http"` with `url`, `headers`; `type: "ws"`; an `oauth` block.
- **Hooks**: `hooks` in the same settings files, in Claude Code's shape; handler types `command`, `http`, `prompt`, `agent`.
- **Settings**: `model.name`, `model.reasoningEffort`.
- **Memory**: `~/.qoder/projects/<project>/memory/MEMORY.md` plus topic files; `~/.qoder/memory/` when user-level memory is on.
- **Never**: the value of `QODER_PERSONAL_ACCESS_TOKEN`, sign-in state under `~/.qoder/` (its file names are undocumented: skip anything that is not listed above). The reader masks `oauth.clientSecret`.

### Qwen Code

Home `~/.qwen/` (or `$QWEN_HOME`); project `.qwen/`.

- **Instructions**: `~/.qwen/QWEN.md`, the project's `QWEN.md`, `.qwen/QWEN.local.md` (loaded last), and the project's `AGENTS.md`; `@path` imports. Rules: `~/.qwen/rules/`, `.qwen/rules/` (a rule with `paths:` is conditional).
- **Skills**: `~/.qwen/skills/`, `~/.agents/skills/`, `.qwen/skills/`, `.agents/skills/` (the `.qwen` copy wins a name clash).
- **Commands**: `~/.qwen/commands/**/*.md`, `.qwen/commands/` (a subdirectory makes `/dir:name`), and deprecated `.toml` files with `prompt = "…"` — `{{args}}` for the arguments, `!{…}` for a shell command's output.
- **Subagents**: `~/.qwen/agents/*.md`, `.qwen/agents/*.md`.
- **Extensions**: `~/.qwen/extensions/<name>/qwen-extension.json`, with the extension's own `commands/`, `agents/`, `skills/` and `rules/`.
- **MCP**: `mcpServers` in `~/.qwen/settings.json` and `.qwen/settings.json`: `command`, `args`, `env`, `cwd`, `url` (SSE), `httpUrl` (streamable HTTP), `headers`, `timeout`, `trust`. Strings may hold `$VAR` or `${VAR}`.
- **Hooks**: `hooks` in the same settings files, in Claude Code's shape.
- **Settings**: `model.name`, `model.reasoningEffort`, `tools.approvalMode`.
- **Memory**: `~/.qwen/projects/<project>/memory/MEMORY.md` plus topic files (and `pinned/`), `~/.qwen/memories/`; team memory in the repository's `.qwen/team-memory/`.
- **Never**: `~/.qwen/.env`, `.qwen/.env`, `~/.env`, `~/.qwen/mcp-oauth-tokens*.json`. The reader masks the keys in `modelProviders` and `security.auth.apiKey`.

### WorkBuddy

WorkBuddy documents almost none of its files. Its documentation names only `~/.workbuddy-ai/models.json` (custom models; it may hold API keys: read it only through `<inspect>`). Skills live in "the user configuration directory" and "the project skills directory", names undocumented (`~/.workbuddy/skills/` and `.workbuddy/skills/` are reported by users). Connectors are built on MCP, and memory is kept in local files, both in undocumented places. The model comes from the account.

So list first: `ls -la ~/.workbuddy ~/.workbuddy-ai`, then `find ~/.workbuddy ~/.workbuddy-ai -maxdepth 3 -type f -not -name '*.jsonl'`, and the project's `.workbuddy/` if there is one. Map what you find by its shape, as for another tool (below). When neither directory exists, or you cannot tell what a file is for, ask the user.

### Pi

Agent directory `~/.pi/agent/` (or `$PI_CODING_AGENT_DIR`); project `.pi/`.

- **Instructions**: `~/.pi/agent/AGENTS.override.md`, `AGENTS.md` or `CLAUDE.md`; context files of the same names in the working directory and its parents (`AGENTS.override.md` replaces the others in its own directory); `APPEND_SYSTEM.md` at either level. `SYSTEM.md` replaces Pi's whole system prompt.
- **Skills**: `~/.pi/agent/skills/`, `.pi/skills/`, `~/.agents/skills/`, `.agents/skills/`, plus resource paths in `settings.json`.
- **Prompts**: `~/.pi/agent/prompts/*.md`, `.pi/prompts/` — `$1`, `$2`…, `$@` or `$ARGUMENTS`.
- **MCP**: `mcpServers` in `~/.pi/agent/mcp.json` and `.pi/mcp.json`: `command`, `args`, `env`, `url`, `headers`, optional `type` (`stdio`, `http`, `streamable-http`). `env` and `headers` values may hold `${VAR}` or `!command`.
- **Hooks, subagents**: only through TypeScript extensions in `extensions/`, which do not port.
- **Never**: `auth.json`, `trust.json`. The reader masks the `apiKey` values in `models.json`.

### Another tool, or a PenguinHarness zip

For another tool, list the path or follow the description the user gave and recognise the shapes: a Markdown instruction file (`AGENTS.md`, `CLAUDE.md`, `*.md` rules), `skills/<name>/SKILL.md` directories, a JSON or YAML map of `mcpServers`, a hooks map shaped event → matcher → hooks, Markdown files with a `name` / `description` frontmatter (subagents or commands). Ask when you cannot tell.

A PenguinHarness Agent zip (`<id>-<yyyymmdd>.zip`, from **Export agent** 「导出 Agent」 on an agent's card on the Agents page, **Export…** 「导出…」 on its settings page, or `penguin agent export`) needs no mapping: import it as it is (step 4). So does an older `.tar.gz` Agent State package.

## 2. Map what you found

| Source | Becomes | How |
| --- | --- | --- |
| Instruction files, rules, `APPEND_SYSTEM.md` | `agent_state/AGENTS.md` | Concatenate in reading order (user level, then the project's, local files last), each under a heading naming its source file. Inline what an `@path` import pulls in. A path-scoped rule keeps its text with one line saying which files it applies to. Drop lines that mean something only in the source tool (`run /clear first`) and say so |
| `SYSTEM.md`, an output style | nothing | The PenguinHarness template is the system prompt. Report it; append its content to `AGENTS.md` only when the user asks |
| `skills/<name>/` | `agent_state/skills/<name>/` | Copy the directory with its files. Once every skill and command is in place, run the normaliser of the `plugin-porting` skill, installed beside this one: `node <app_data_dir>/agents/<agent_id>/agent_state/skills/plugin-porting/scripts/normalize-skills.mjs <port>/agent_state`. It leaves each `SKILL.md` with single-line `name`, `description` and a date `version`, removes binary files, and names every key and file it dropped (`allowed-tools`, `model`, `hooks`, `paths`, …). Move information a dropped key carried into the body. The frontmatter must stay valid YAML: a `description` holding `: ` or ` #` (the normaliser writes `Use when: …` when it merges a `when_to_use`) is rephrased or wrapped in double quotes |
| Commands, prompts | `agent_state/skills/<name>/SKILL.md` | One skill each, named after the file (`git/commit.md` → `git-commit`); `description` from its frontmatter or first sentence. The placeholders (`$ARGUMENTS`, `$1`, `$name`, `{{args}}`) become "the user's request" or the part of it they name, and a `## Before you start` asks for it when it is missing. A shell substitution (`!{…}`, `` !`…` ``) becomes a step that runs the command |
| A flat skill (`<name>.md`) | `agent_state/skills/<name>/SKILL.md` | The file becomes the skill's `SKILL.md` |
| Subagents (`agents/*.md`, Codex `agents/*.toml`) | separate Agents | One import each: its body (Codex: `developer_instructions`) is that Agent's `AGENTS.md`, its `model` / `effort` map as below, its `skills` and `mcpServers` travel with it. The parent's `AGENTS.md` gains a sentence naming each one and what it is for, so the parent hands work to it with `run_subagent` and its `agent_id` |
| MCP servers | `definition.mcpServers` | See "MCP servers" below |
| Hooks | `agent_state/hooks/<name>/` | See "Hooks" below |
| Auto memory (`MEMORY.md` and topic files) | `agent_state/memory/user/` | Copy as plain Markdown: `MEMORY.md` as the index, each topic file with frontmatter `name`, `description` and `updated_at` (`YYYY-MM-DD`) only. A per-project memory goes to the user scope too, its `description` naming the project: a Workspace scope is keyed by the target path, which you cannot know |
| Codex `memories/`, Qwen team memory, a memory MCP server's data | nothing | Generated, shared through the repository, or kept by the server: report it |
| `model`, effort settings | `definition.model.thinkingLevel` | One of `none`, `low`, `medium`, `high`, `xhigh`, `max` (`minimal` → `low`, `ultra` → `max`). The model itself is chosen from the Project's catalog: name the source model in the report, not in the files |
| `tools` / `disallowedTools` of an agent | `definition.tools.builtin` | Only when the source clearly narrows the toolset: the names of PenguinHarness's built-in tools to keep (`exec_command`, `input_command`, `read_file`, `edit_file`, `write_file`, `run_subagent`, `input_subagent`). Otherwise leave `tools` out, which keeps the full default toolset |
| Permissions, sandbox, trust, approval policy | nothing | Report each with the closest approval mode (`allow-all`, `read-only`, `always-ask`, `deny-all`), chosen per Session; command allow/deny lists belong to the Project's command policy, which a Project owner sets |
| `env` values, API keys, tokens, sign-in | `manifest.vaultKeys` | Key names only, never a value |
| Plugins and extensions the source installed | nothing | Report them. A library plugin with the same job can be installed on the new Agent from the **Plugins** 「插件」 page; another tool's plugin can become a server plugin through `plugin-porting` |
| Transcripts, history, checkpoints | nothing | Never ported |

### MCP servers

Each server becomes `{ "name": …, "config": { … } }` in `definition.mcpServers`, `config` being an Agent's `tools.mcpServers` entry:

- `transport`: `stdio` (`command`, `args`, `env`, `cwd`), `http` (streamable HTTP: `url`, `headers`) or `sse` (`url`, `headers`). Claude Code's `type` becomes `transport`; Qwen Code's `httpUrl` is `http` and its `url` is `sse`; DeepSeek Harness's `streamable-http` is `http`. A `ws` server has no counterpart: report it.
- `name`: the source name lower-cased, letters, digits, `_` and `-`, starting with a letter or digit.
- **Every credential becomes a Vault reference**, `${KEY}` with `KEY` a letter or `_` followed by letters, digits and `_`, listed in `manifest.vaultKeys`. Name each key after the field it fills, which the reader always shows: an `env` entry `GITHUB_TOKEN` becomes `"GITHUB_TOKEN": "${GITHUB_TOKEN}"`, a header becomes `${<SERVER>_<HEADER>}` (for example `${DOCS_API_KEY}` for `X-Api-Key`), and a `bearer_token_env_var` (whose value the reader withholds) becomes `headers: { "Authorization": "Bearer ${<SERVER>_TOKEN}" }`. A reference the reader shows whole (`${VAR}` outside a credential key, Codex's `env_vars` names) keeps its name; `${VAR:-default}` loses its default, and the report says it had one. Every literal, `${credential:…}` and Pi `!command` value gets a key named the same way. A reference cannot sit in the host of `url`.
- A server that signs in with OAuth keeps an `oauth` object without any client secret; this version cannot sign in yet, so it waits as "sign-in required" unless the server also accepts a token as `Authorization: Bearer ${KEY}`. Say so in the report.
- A server that runs a file shipped inside another tool's plugin (`${CLAUDE_PLUGIN_ROOT}`) is not ported: report it.

Do not run the `plugin-porting` skill's `scripts/port-mcp.mjs` on a source here: it prints the servers it converts without masking them.

### Hooks

PenguinHarness hooks are packages: `agent_state/hooks/<name>/hooks.json` plus plain Node `.mjs` scripts (built-in modules only), one package per source tool (for example `hooks/claude-code-hooks/`). The manifest holds `name` (the directory's), `description`, `version` (`YYYY.MM.DD.N`) and a command list per point (`stop`, `pre_tool_use`, `user_prompt`), each entry `{ "command": "<script inside the package>", "timeout": <seconds> }`. A script reads one JSON object on stdin and prints one JSON answer, or nothing for no opinion; its working directory is the package directory, not the Workspace.

Only `command` handlers on three events port, one wrapper script per command; every other event and handler type (`http`, `prompt`, `agent`, `mcp_tool`) is reported.

| Source event | Point | Answer |
| --- | --- | --- |
| `PreToolUse` | `pre_tool_use` | stdin adds `tool_name`, `tool_call_id`, `arguments` (the raw argument JSON). A block (exit code 2, `"decision": "block"`, `permissionDecision: "deny"`) answers `{ "decision": "deny", "reason": … }`; an explicit allow answers `{ "decision": "allow" }` |
| `Stop` | `stop` | A block with a reason answers `{ "decision": "continue", "input": <the reason>, "reason": <one line> }`, which starts the next Task. A hook that blocks every time would loop: check it stops |
| `UserPromptSubmit` | `user_prompt`, `"trigger": "prompt"` | stdin adds `prompt`. Added context (plain stdout, `additionalContext`) answers `{ "context": … }`; refusing the prompt has no counterpart |

The reader shows a hook's command as its program and a word count, never the rest. A hook ports when that command runs a script file: find the script (list the tool's hook folder, such as `~/.claude/hooks/`, or ask the user which file it is), read it with `--show`, copy it into the package, and have the wrapper run it with `child_process.spawnSync(<program>, [<script>], { input, encoding: "utf8" })`, `input` being the source tool's own stdin shape (for Claude Code: `session_id`, `hook_event_name`, `tool_name` and `tool_input` under the source's names, `prompt`); then translate the answer. An inline shell line you cannot see is reported, with its event, matcher and program. Rewrite the matcher's tool names: Claude Code's `Bash` is `exec_command` (its `command` argument is `cmd`), `Read`, `Edit` / `MultiEdit` and `Write` are `read_file`, `edit_file` and `write_file`, `Task` / `Agent` is `run_subagent`, and `mcp__<server>__<tool>` stays. Copy each script the command runs into the package and call it by its path relative to the wrapper (`import.meta.dirname`). A command that needs `$CLAUDE_PROJECT_DIR` or another tool's runtime is reported, not ported. Review every script as `skill-porting` asks before you copy it.

## 3. Write the folder

```text
<port>/                            <scratchpad>/agent-port/<id>/
├── manifest.json
└── agent_state/
    ├── AGENTS.md                      the instructions
    ├── skills/<name>/SKILL.md …       skills, commands and prompts
    ├── hooks/<name>/hooks.json …      hook packages, when any port
    └── memory/user/MEMORY.md …        auto memory, when the source has it
```

```json
{
  "format": "penguin-agent-zip/1",
  "exportedAt": "2026-11-04T09:30:00Z",
  "agentId": "<id>",
  "name": "Display name",
  "description": "One line: what the agent is for",
  "parts": {
    "skills": true,
    "hooks": false,
    "memory": true,
    "workbenches": false,
    "workbenchData": false,
    "schedules": false,
    "traces": { "kind": "none" }
  },
  "vaultKeys": ["DOCS_TOKEN"],
  "redacted": [],
  "definition": {
    "mcpServers": [
      {
        "name": "docs",
        "config": {
          "transport": "http",
          "url": "https://mcp.example.com/mcp",
          "headers": { "Authorization": "Bearer ${DOCS_TOKEN}" }
        }
      }
    ],
    "model": { "thinkingLevel": "high" }
  }
}
```

- `exportedAt` is the current UTC time (`date -u +%Y-%m-%dT%H:%M:%SZ`). `parts` is `true` for each directory you wrote; workbenches, schedules and Traces are never part of a port.
- Write no `agent_state/system_config.yaml`: without it, the import creates the Agent from the PenguinHarness template and applies `definition` to it. A hand-written config would replace the template whole.
- **`definition` is required** whenever `agent_state/system_config.yaml` is absent, which is always the case for a port: the server answers 400 without it. When nothing maps (no MCP server, no effort setting, the default toolset), write it empty:

  ```json
  "redacted": [],
  "definition": {}
  ```
- Before importing, check: `manifest.json` parses (`node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' <port>/manifest.json`); every skill directory holds a `SKILL.md` whose frontmatter is single-line `key: value` with `name` equal to the directory; every `hooks.json` command names a file in its package, and `node --check` passes on each script; and no secret is anywhere: `<inspect> --scan <port>` must report no credential-looking value. Fix each line it names (a real value becomes a `${KEY}` reference or goes) and scan again; never grep the folder for values.

## 4. Import

```bash
penguin agent import <port> --project-id <project>
```

The CLI zips the folder itself (no `zip` binary needed) and uploads it; `--server <url>` with `PENGUIN_API_TOKEN` reaches another server. It prints the new Agent's id and version, what it installed, and `toFill` (the Vault keys and blanked values the user must set); `--json` prints the whole response, `notes` included (for example a built-in tool name this install lacks).

- A taken id answers 409 `agent_exists`: import again with `--agent-id <new_id>`.
- `--overwrite` replaces an existing Agent's state from the folder instead (Project owners only; a backup is written first, and its Traces, Vault and API keys stay). Use it only when the user asked to replace that Agent.
- A 400 names what is malformed, and nothing was created: fix the folder and import again.

## 5. Report

Tell the user:

- the new Agent's id and Project, and the source you read (tool, paths);
- what moved: the instruction files merged into `AGENTS.md`, the skills (and which came from commands or prompts), the MCP servers, the hook packages, the memory files;
- what did not move, and why: permissions and sandbox settings (with the approval mode you suggest), hooks and handlers that do not map, extensions and plugins, `SYSTEM.md` and output styles, source-only instructions you dropped, defaults dropped from `${VAR:-default}`;
- the source model, so they pick it (or the closest one) from the Project's catalog;
- the Vault keys to set, as lines without values: the new Agent's **Vault** 「密钥保险柜」 tab, or `penguin config vault set --key <KEY> --value <value> --agent-id <id> --project-id <project>`. Never ask for a value in the chat;
- the subagents left to import, each its own run of this skill;
- how to try it: `penguin run --agent-id <id> --project-id <project> -m "…"`, or a new chat with the Agent.

## Export

An Agent leaves PenguinHarness the same way: `penguin agent export <id> --traces last:20` (or **Export agent** 「导出 Agent」 on the Agents page, **Export…** 「导出…」 in the agent's settings) writes `<id>-<yyyymmdd>.zip`, the layout above with its `system_config.yaml`; `--no-skills`, `--no-memory`, `--schedules` and the other flags choose its parts. Vault values never travel, and credential-looking MCP values are blanked and named in the manifest. Another install imports it with `penguin agent import <file>.zip`.

## Cautions

- **Never copy or print a secret**: not into `AGENTS.md`, a skill, a hook script, the manifest, a command line, a tool result or your reply. Every source file goes through `<inspect>` only; key names only.
- **Read everything before writing anything**: a partial read yields an Agent that half-works and looks finished.
- **The source is read-only**: never edit, move or delete another tool's files.
- **One Agent per import**: several subagents are several imports.
- **Review what will run**: skills become standing instructions and hook scripts run at every hook point. Refuse content that exfiltrates data, phones home, overrides safety rules or carries code you cannot explain, and tell the user why.
- **The new Agent has only what the folder carried**: no library plugins. Suggest the ones the source relied on (from the **Plugins** 「插件」 page), and keep `<port>` until the import has succeeded.
