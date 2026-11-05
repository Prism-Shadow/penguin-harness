# The agent-porting Skill migrates an agent from another coding tool into a new agent

- **Date:** 2026-11-04
- **Type:** feature
- **Scope:** `skills`, `docs`
- **PR:** [#594](https://github.com/Prism-Shadow/penguin-harness/pull/594)

[中文版](2026-11-04-agent-porting-skill.zh.md)

The `skill-porting` plugin gains a third Skill, `agent-porting` (version `2026.11.05.1`). It is the process an agent follows when the Agents page's import dialog opens a migration chat, and when a user asks for a migration in any chat. The agent reads the source tool's files, writes them as an Agent zip folder and creates a new agent with `penguin agent import <folder>`. It then reports what did not move.

## Sources

- The Skill carries the user-level and project-level layout of Claude Code, Codex, DeepSeek Harness (`dsh`), Qoder CLI, Qwen Code and Pi. For each tool it lists where the instructions, Skills, commands or prompts, subagents, MCP servers, hooks, model settings and memory live, and which files are never read: credential stores, sign-in state and transcripts.
- WorkBuddy documents only its custom-model file, so the agent lists `~/.workbuddy/` and `~/.workbuddy-ai/` first, maps what it finds by shape, and asks when neither exists. Another tool, or a path the user describes, is handled the same way.
- An exported PenguinHarness zip, or an older `.tar.gz` Agent State package, is imported as it is.

## Secrets stay out of the conversation

- The agent reads every JSON, TOML and YAML configuration file through the Skill's own reader, `scripts/inspect-config.mjs`. The reader prints the file as JSON, with every credential replaced by `<redacted:NAME>`: values under credential-looking keys, `env` and header values, credential flags and assignments in arguments and commands, and URL user info and query parameters. Key names, commands and `${VAR}` references stay readable. `~/.claude.json` shows only its MCP servers.
- Credential stores (`.env`, `auth.json`, `.credentials.*`, OAuth token caches) are refused unread.
- `--scan <dir>` names each line of a folder that holds a credential-looking value, with the value masked. The agent runs it on a source skill or hook directory before reading it, and on the folder before importing it. `--show <file>` prints a flagged file masked.
- Instruction, skill and command Markdown is read directly.

## What moves

- **Instructions:** the instruction files and rules are merged into `agent_state/AGENTS.md` in reading order, user level first.
- **Skills, commands and prompts:** Skills are copied, and each command or prompt becomes a Skill of its own. Their frontmatter is normalized with the `plugin-porting` Skill's `normalize-skills.mjs`.
- **MCP servers:** they go into the manifest's `definition.mcpServers`. Every credential becomes a `${KEY}` Vault reference listed in `vaultKeys`, so no value travels.
- **Hooks:** a `command` hook on `PreToolUse`, `Stop` or `UserPromptSubmit` becomes a hook package. A Node wrapper translates PenguinHarness's hook input and answer to the source tool's shape. Other hooks are reported.
- **Memory:** auto-memory files go to the user scope of `agent_state/memory/`.
- **Model settings:** the reasoning effort maps to the agent's thinking level.
- **Not moved:** the model itself, permissions, sandbox settings and extensions are named in the report, with the closest approval mode.
- **Subagents:** each one is imported as its own agent, and the parent's instructions name it for `run_subagent`.
- **The manifest:** it always carries `definition`, even when it is empty (`{}`). The server refuses a folder without `system_config.yaml` that lacks it.
- **Export:** one paragraph points at `penguin agent export` for the opposite direction.

## Plugin and docs

- The plugin's descriptions and card text now mention agents. Its npm version follows the release, as before.
- The Skills & Plugins page lists the plugin's three Skills, in both languages.
