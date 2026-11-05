# The agent-porting Skill migrates an agent from another coding tool into a new agent

- **Date:** 2026-11-04
- **Type:** feature
- **Scope:** `skills`, `docs`
- **PR:** [#594](https://github.com/Prism-Shadow/penguin-harness/pull/594)

[中文版](2026-11-04-agent-porting-skill.zh.md)

The `skill-porting` plugin gains a third Skill, `agent-porting` (version `2026.11.05.2`). It is the process an agent follows when the Agents page's import dialog opens a migration chat, and when a user asks for a migration in any chat. The agent reads the source tool's files, writes them as an Agent zip folder and creates a new agent with `penguin agent import <folder>`. It then reports what did not move.

## Sources

- The Skill carries the user-level and project-level layout of Claude Code, Codex, DeepSeek Harness (`dsh`), Qoder CLI, Qwen Code and Pi. For each tool it lists where the instructions, Skills, commands or prompts, subagents, MCP servers, hooks, model settings and memory live, and which files are never read: credential stores, sign-in state and transcripts.
- WorkBuddy documents only its custom-model file, so the agent lists `~/.workbuddy/` and `~/.workbuddy-ai/` first, maps what it finds by shape, and asks when neither exists. Another tool, or a path the user describes, is handled the same way.
- An exported PenguinHarness zip, or an older `.tar.gz` Agent State package, is imported as it is.

## Secrets stay out of the conversation

- The agent reads every source file through the Skill's own reader, `scripts/inspect-config.mjs`, and through no other command.
- A JSON, TOML or YAML configuration file prints as JSON by allowlist:
  - key names, numbers and booleans print;
  - a string prints only when it is a `${VAR}` reference, the value of a structural key (`name`, `type`, `transport`, `command`, `cwd`, `matcher`, `model`, effort and approval settings), an `args` flag, package or path, or a URL's scheme, host and path;
  - a shell line under `command` prints only its program and a word count;
  - every other string prints as `<redacted:N chars>`, and under a credential key a reference keeps only its structure;
  - `~/.claude.json` shows only its MCP servers.
- A file that does not parse names its line and prints only its key names, never its content.
- `--scan` names each line of a file or folder that looks like it holds a credential as `file:line: <kind>`, and never prints the line. The agent runs it before reading any source directory and before the import.
- `--show` prints a text file (instructions, skills, commands, scripts) with each flagged line replaced whole, and a private key block to its end.
- Credential stores (`.env`, `*.env`, `.envrc`, `auth.json`, `.credentials.*`, OAuth token caches, `*.pem`, `*.key`, `id_rsa*`, `.netrc`, `.npmrc`, `.pypirc`) are refused unread.
- A hook whose command is a script file ports through that script; an inline shell line, which the reader never shows, is reported.

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
