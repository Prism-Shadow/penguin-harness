---
name: agent-porting
description: Import an agent into PenguinHarness from a Claude Code, Codex or Pi setup or from an exported PenguinHarness bundle — map instructions, commands, skills, MCP servers and hooks into a penguin-agent.json plus skills directories and run `penguin agent import` — and export an agent as a bundle (definition, skills, hooks, an API integration guide and runnable clients) for another install, a coding agent or an HTTP integration.
---

# Agent Porting

An agent moves between tools as a **portable definition** — `penguin-agent.json` — with its skills beside it. PenguinHarness writes one on export and reads one on import; for Claude Code, Codex or Pi you write it from what their files say. Import creates a *new* agent in the current Project; export packages an existing one. Neither carries vault values.

This is not the Agent State snapshot (the `.tar.gz` backup of one agent's whole state directory on its settings page): a snapshot backs up or restores, porting moves an agent between tools or hands it to someone.

## Before you start

If the user's message only invokes this skill (e.g. "use agent-porting") without saying which agent to import or export, ask: import or export, from or to where, and which agent. Do not read any configuration or run any command until that is clear. When the request names a source (a directory, a zip, a tool) or an agent to export, proceed without further questions and list your assumptions in the final reply.

## The portable definition

`penguin-agent.json` with `"format": "penguin-agent/1"`. Only `format` and `id` are required:

| Field | Meaning |
| --- | --- |
| `id` | The agent id to create: `^[a-z][a-z0-9_]{1,63}$` — a lowercase letter first, then lowercase letters, digits and underscores, no hyphens. `penguin agent import --agent-id` overrides it |
| `name`, `description` | Display name (defaults to the id) and a one-line description |
| `prompt` | The agent's instructions, written as its AGENTS.md verbatim. A CLAUDE.md, an AGENTS.md or a system prompt maps here |
| `systemPrompt` | Only for penguin-to-penguin moves: the `system_prompt` template with PenguinHarness placeholders. Omit it otherwise — the default template is right |
| `skills` | `[{ "name", "version"?, "description"? }]`: what the agent should have. The files travel in `skills/<name>/` next to the JSON, inside a zip |
| `hooks` | `[{ "name", "version"?, "description"? }]`: hook packages, files in `hooks/<name>/` (`hooks.json` plus scripts) |
| `tools.builtin` | Names of PenguinHarness built-in tools to keep enabled; omit to keep the default toolset |
| `mcpServers` | `[{ "name", "config": { "transport", "command", "args", "env", "url", "headers", ... } }]`, credential values left empty |
| `model` | `{ "thinkingLevel"?: "low" \| "medium" \| "high" \| "xhigh" \| "max", "maxTokens"?, "timeoutMs"? }` |
| `vaultKeys` | Environment variable names the agent expects; the user sets the values afterwards |

A bare `penguin-agent.json` imports on its own. To carry skills or hooks, zip it together with `skills/<name>/SKILL.md` (and the skill's reference files) and `hooks/<name>/hooks.json` (and its scripts): `zip -r <id>-export.zip penguin-agent.json skills hooks`.

## Import

### 1. Locate and read the source, all of it

Read the files themselves, not a summary of them. Ask for the path when it is not obvious, and never invent a layout that is not on disk. What to look for:

**Claude Code.** User level under `~/.claude/`: `CLAUDE.md` (instructions), `settings.json` (`permissions`, `hooks`, `env`, `model`), `commands/*.md` (slash commands), `skills/<name>/SKILL.md`, `agents/*.md` (subagent definitions with `name` / `description` / `tools` / `model` frontmatter); MCP servers under `mcpServers` in `~/.claude.json`, user-wide and per project. Project level, inside a repository: `CLAUDE.md` or `.claude/CLAUDE.md`, `CLAUDE.local.md`, `.claude/settings.json`, `.claude/settings.local.json`, `.claude/commands/`, `.claude/skills/`, `.claude/agents/`, `.mcp.json`. Each `agents/*.md` is a candidate agent of its own: ask which one the user means, or import several.

**Codex.** `~/.codex/config.toml` (`model`, `model_provider`, `model_reasoning_effort`, `approval_policy`, `sandbox_mode`, `[mcp_servers.<name>]` tables with `command` / `args` / `env` or `url`, `[profiles.<name>]`, `[[skills.config]]`), `~/.codex/AGENTS.md` (global instructions), `~/.codex/prompts/*.md` (custom prompts); skills under `~/.agents/skills/` and a repository's `.agents/skills/`; inside a repository, `AGENTS.md` (nested ones too) and `.codex/config.toml`.

**Pi coding agent.** `~/.pi/agent/`: `settings.json` (where extensions, skills, prompts and themes load from, paths relative to that directory), `AGENTS.md`, `SYSTEM.md` (a replacement system prompt), `prompts/*.md` (prompt templates), `skills/<name>/SKILL.md`, `agents/*.md` (subagent definitions, with the subagent extension), `extensions/` (TypeScript — not portable), `models.json`, `auth.json` (never read the values). Project level in `.pi/` and the repository's `AGENTS.md`.

**PenguinHarness bundle.** An `<id>-export.zip` or a bare `penguin-agent.json`: nothing to map, go straight to step 4 (with `--agent-id` when the id is taken).

Read as well what the instructions point at (a `CONTRIBUTING.md`, a style guide) and every file a command or skill references.

### 2. Map what you found

| Source | Becomes | How |
| --- | --- | --- |
| `CLAUDE.md`, `AGENTS.md`, `SYSTEM.md`, a subagent's body, a system-prompt field | `prompt` | Concatenate in reading order (user level, then project level), keep the wording; drop sections that only mean something in the source tool (e.g. "run `/clear` first") and say so in the report |
| `commands/*.md`, `prompts/*.md` | `skills/<name>/SKILL.md` | One skill per command: frontmatter `name` (the file stem, `[A-Za-z0-9_-]+`) and `description` (its first sentence), the command text as the body, a `## Before you start` section that asks for the argument when the command took one; an `$ARGUMENTS`-style placeholder becomes "the user's request" |
| `skills/<name>/` (any tool — the same SKILL.md convention) | `skills/<name>/` | Copy the directory, reference files included; keep the frontmatter, add `## Before you start` when missing |
| `mcpServers` (Claude Code), `[mcp_servers.*]` (Codex), `.mcp.json` | `mcpServers` | `{ "name", "config": { "transport": "stdio" or "http", "command", "args", "env", "url", "headers" } }`. Copy the keys of `env` / `headers`, **leave every credential value empty**, and list the key under "to fill in" |
| `settings.json` `hooks`, Codex `notify`, Pi extensions | `hooks/<name>/` | Only a shell or Node script that runs when a turn stops or before a tool call maps onto a hook package (`hooks.json` with `stop` / `pre_tool_use` / `user_prompt` command lists; scripts run with Node). Everything else is reported as not ported |
| `model`, `model_reasoning_effort` | `model.thinkingLevel` | `low` / `medium` / `high` / `xhigh` / `max`. The model itself is picked per Session in PenguinHarness: name the source model in the report, not in the definition |
| `permissions` allow/deny lists, `approval_policy`, `sandbox_mode` | nothing | PenguinHarness has approval modes per Session and a Project-level command policy, not per-agent allow-lists: report them as unsupported and suggest the closest mode (`allow-all`, `read-only`, `always-ask`) |
| `env` values, `auth.json`, API keys in any file | `vaultKeys` (names only) | Never copy a value. Report the names and where they go: the agent's Vault tab, or `penguin config vault set --agent-id <id> --key <NAME> --value <value>` |
| `agents/*.md` subagents | separate agents | Each is its own definition. PenguinHarness spawns subagents through `run_subagent`, so a parent's list of subagents becomes a sentence in `prompt` naming the agents to hand off to |

### 3. Write the definition and the skills

Work in a scratch directory under the current workspace (`./agent-port/<id>/`): `penguin-agent.json`, then `skills/<name>/SKILL.md` (with reference files) and `hooks/<name>/` as mapped. Pick a valid `id` and check `penguin agent ls` for collisions. Before importing, verify: the JSON parses; every skill directory has a `SKILL.md` whose frontmatter sets `name` and `description`; no secret value anywhere (`grep -ri "key\|token\|secret\|password" agent-port/` and read every hit).

### 4. Import

```bash
cd agent-port/<id> && zip -r ../<id>-export.zip penguin-agent.json skills hooks   # no zip needed for a JSON-only definition
penguin agent import ../<id>-export.zip [--agent-id <id>] [--project-id <project>]
```

The command prints the new agent's id, what it installed, what it could not apply (a named skill without a directory, a built-in tool this install lacks) and the vault keys to set. A taken id is a 409 `agent_exists`: pass `--agent-id` with a new one. The CLI talks to the running server; `--server <url>` with `PENGUIN_API_TOKEN` targets another one.

### 5. Report

Tell the user: the new agent's id and Project; what was mapped (instructions, N skills, M MCP servers, hooks); what was not and why (permissions, extensions, hooks that did not map, source-tool-only instructions); the vault keys to set; and how to try it (`penguin run --agent-id <id> -m "..."`, or the Web App).

## Export

```bash
penguin agent export <id> [--out <dir-or-file>] [--kind api|docker] [--project-id <project>]
# --kind api (default) writes <id>-export.zip; --kind docker writes <id>-docker.zip
```

Both kinds carry `penguin-agent.json`, `skills/` and `hooks/`, so either zip re-imports. They differ in what is packed around that core, and the Agents page's Export button offers the same two plus a third path that asks an agent for a shape neither covers (an SDK, Kubernetes manifests, a handover document — that path is you, reading this skill).

The `api` bundle carries `penguin-agent.json`, `skills/`, `hooks/`, `README.md` (an integration guide written for a coding agent: what the agent is, the four server API calls that run it with the Project and agent ids filled in, the CLI commands, its skills and tools, its limits), `api/ENDPOINTS.md`, and `examples/curl.sh` / `client.py` / `client.ts` — runnable clients that create a Session, send a task and print the final answer, reading `PENGUIN_SERVER` and `PENGUIN_API_TOKEN` from the environment. Vault values, memory, Traces, schedules and snapshots are not in it; the README lists the vault key names to set. Credential-looking MCP `env` / `headers` values are blanked and nothing else is, so read `mcpServers` for a token in a `url` query string or in stdio `args` before you hand the bundle to anyone.

The `docker` bundle carries `Dockerfile`, `docker-compose.yml`, `entrypoint.sh`, `.env.example`, a README for running it and `api/ENDPOINTS.md`. The container installs the CLI, and on first boot writes the model configuration from the environment, starts the server, imports the agent and drops a sentinel so restarts skip the import; the data root is a volume, so removing it re-imports. It reads `PENGUIN_MODEL_PROVIDER` / `PENGUIN_MODEL_ID` / `PENGUIN_MODEL_API_KEY` (plus `PENGUIN_MODEL_BASE_URL` for an OpenAI-compatible endpoint), `PENGUIN_ADMIN_PASSWORD`, and one variable per vault key the agent declares. The image pins nothing by default: pass `--build-arg PENGUIN_VERSION=<version>` for anything you intend to keep.

Four ways to use an export:

- **Move the agent** to another PenguinHarness: `penguin agent import <id>-export.zip` there (or the Agents page's Import agent button), then set the vault keys.
- **Hand it to a coding agent**: unzip it and give that agent `README.md` and `examples/` — enough to call this agent from its own code. Point it at the server URL and give it a token (`~/.penguin/data/api-token` on the server's machine, or `penguin auth login --server <url>` from elsewhere); never paste a token into a file that gets committed.
- **Publish the agent as an HTTP API**: the PenguinHarness server already is that API, and `api/ENDPOINTS.md` documents it for this agent. Run the server where the callers can reach it (`penguin server --host <address> --port <port>`, or behind a reverse proxy), hand out tokens, and keep `allow-all` or `read-only` approval for unattended callers.
- **Ship it as a container**: `--kind docker`, fill in `.env`, `docker compose up --build`. The agent's tools then run inside the container with its permissions — which is the reason to containerise it — but it still reaches the network, and nothing in the bundle terminates TLS or authenticates anyone but the built-in admin. Put it behind something that does before exposing it.

When you are asked to produce a shape none of these cover, start from `penguin agent export <id> --out <dir>`, read the definition and its documents, and write the result into the Workspace. Never write a vault value into what you produce; list the key names the reader has to set.

## Cautions

- **Never copy secrets** — not into the definition, not into a skill, not into your reply. Key names only.
- **Read everything before writing anything**: a partial read yields an agent that half-works and looks finished.
- **Do not edit the source tool's files**; porting is read-only on the source.
- **One agent per definition.** Several subagents mean several imports.
- An imported agent starts with only what the bundle carried, no library plugins: suggest `penguin-orchestration` or other library plugins when the source relied on their equivalents.
