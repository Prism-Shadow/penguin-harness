# The agent-porting Skill migrates an agent from another coding tool into a new agent

- **Date:** 2026-11-04
- **Type:** feature
- **Scope:** `skills`, `docs`
- **PR:** [#594](https://github.com/Prism-Shadow/penguin-harness/pull/594)

[中文版](2026-11-04-agent-porting-skill.zh.md)

The `skill-porting` plugin gains a third Skill, `agent-porting` (version `2026.11.05.4`). It is the process an agent follows when the Agents page's import dialog opens a migration chat, and when a user asks for a migration in any chat. The agent reads the source tool's files, writes them as an Agent zip folder and creates a new agent with `penguin agent import <folder>`. It then reports what did not move.

## Sources

- The Skill carries the user-level and project-level layout of Claude Code, Codex, DeepSeek Harness (`dsh`), Qoder CLI, Qwen Code and Pi. For each tool it lists where the instructions, Skills, commands or prompts, subagents, MCP servers, hooks, model settings and memory live, and which files are never read: credential stores, sign-in state and transcripts.
- WorkBuddy documents only its custom-model file, so the agent lists `~/.workbuddy/` and `~/.workbuddy-ai/` first, maps what it finds by shape, and asks when neither exists. Another tool, or a path the user describes, is handled the same way.
- An exported PenguinHarness zip, or an older `.tar.gz` Agent State package, is imported as it is.

## Secrets stay out of the conversation

The Skill ports by writing, not by reading. Its script `scripts/inspect-config.mjs` carries the source's values into the port folder itself, so they go file to file and never through the conversation (and so never into the Session's Trace, which an export may carry).

- **`--emit <config> --framework <tool> --out <port folder>`** parses a Claude Code, Codex, DeepSeek Harness, Qoder, Qwen Code, Pi or other configuration, or a subagent's file, and writes what maps:
  - the MCP servers into `manifest.json`'s `definition.mcpServers`, with commands, arguments, addresses and plain values exactly as the source has them, and each credential replaced by a `${NAME}` Vault reference listed in `vaultKeys`. A credential is a value under a credential name, the word after a credential flag, a credential query parameter, or anything shaped like a token;
  - hook packages for the `command` hooks on `PreToolUse`, `Stop` and `UserPromptSubmit`, each a wrapper that runs the source's command and translates its answer;
  - the thinking level, and a subagent's instructions.

  It prints only a summary: what it wrote, the Vault keys it created, and what it could not map.
- **`--append <file> --to <file>`** copies an instruction file in verbatim without printing it, leaving a frontmatter behind and turning a `paths` scope into one sentence.
- **The masked view** (`<file>`) shows a configuration's structure by allowlist. Variable names print only in environment-variable form. Arguments print only when they are flags or path- or package-shaped, a URL only up to its plain first path segment, a shell line only as its program, and prose only as a pointer to `--show --key`.
- **`--show` and `--scan` are best effort for text.** They also catch password phrases, hex keys, `secret_` and `ntn_` tokens, webhook and secret-looking URL paths, and high-entropy words. They read a Markdown frontmatter by position (`--show` through the masked view). `--scan` prints `file:line: <kind>` only, and exits 1 when it flags anything.
- **A flagged instruction, skill or memory file waits for the user.** `--append` and `--emit` hold it back until `--confirmed`, and the report says the check is best effort.
- **Parse errors** name the line only. **Credential stores** (`.env`, `*.env`, `.envrc`, `auth.json`, `.credentials.*`, OAuth token caches, `*.pem`, `*.key`, `id_rsa*`, `.netrc`, `.npmrc`, `.pypirc`) are refused unread.

## What moves

- **Instructions:** the instruction files and rules are appended to `agent_state/AGENTS.md` in reading order, user level first.
- **Skills, commands and prompts:** Skills are copied, and each command or prompt becomes a Skill of its own. Their frontmatter is normalized with the `plugin-porting` Skill's `normalize-skills.mjs`.
- **MCP servers:** `--emit` writes them into the manifest's `definition.mcpServers`; every credential becomes a `${KEY}` Vault reference listed in `vaultKeys`.
- **Hooks:** `--emit` turns a `command` hook on `PreToolUse`, `Stop` or `UserPromptSubmit` into a hook package whose Node wrapper translates PenguinHarness's hook input and answer to the source tool's shape. Other hooks are reported.
- **Memory:** auto-memory files go to the user scope of `agent_state/memory/`.
- **Model settings:** the reasoning effort maps to the agent's thinking level.
- **Not moved:** the model itself, permissions, sandbox settings and extensions are named in the report, with the closest approval mode.
- **Subagents:** each one is imported as its own agent, and the parent's instructions name it for `run_subagent`.
- **The manifest:** it always carries `definition`, even when it is empty (`{}`). The server refuses a folder without `system_config.yaml` that lacks it.
- **Export:** one paragraph points at `penguin agent export` for the opposite direction.

## Plugin and docs

- The plugin's descriptions and card text now mention agents. Its npm version follows the release, as before.
- The Skills & Plugins page lists the plugin's three Skills, in both languages.
