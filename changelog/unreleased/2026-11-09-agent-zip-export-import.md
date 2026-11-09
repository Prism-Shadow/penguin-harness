# An Agent travels as a zip of its directory

- **Date:** 2026-11-09
- **Type:** feature
- **Scope:** `server`, `cli`, `web`, `ui-gallery`, `skills`, `docs`
- **PR:** [#594](https://github.com/Prism-Shadow/penguin-harness/pull/594)
- **Breaking:** yes — `GET`/`POST …/agents/:agentId/export|import` and the create request's `dataBase64` are removed

[中文版](2026-11-09-agent-zip-export-import.zh.md)

An Agent was exported and imported as a zip of its directory on disk: `<agentId>/agent_state/…` and, for the chosen Sessions, `<agentId>/traces/<date>/<session>_<NNN>.jsonl`. The import reused the snapshot import's validation, backup and swap; only the unpack step was added.

## Server

- `GET /api/projects/:projectId/agents/:agentId/archive` (any member) answered `<agentId>-<yyyymmdd>.zip`. Its query took `skills`, `hooks`, `memory`, `workbenches`, `workbenchData` and `schedules` as `0` or `1` (all `1` but `schedules`), and `traces` as `none`, `last:<N>` (1–500 by last activity, a subagent Session with its parent) or a range of date folders. It left out what a snapshot leaves out, replaced a vault value of 8 characters or more in a Trace with `[vault:<KEY>]`, and answered 413 `archive_too_large` past the import's caps.
- `POST /api/projects/:projectId/agents/import?agentId=<id>&overwrite=1` took the raw file, under a body cap of its own of 64MB. The zip was unpacked into the layout a tar.gz snapshot extracts to, refusing links, entries outside its folder, control characters and names that differ only in letter case, with the caps read off the central directory. A free id created the Agent (any member); a taken one answered 409 `agent_exists` with `details.agentId`, and `overwrite=1` (owner only) replaced the State after a backup snapshot, keeping the vault, the Sessions, the API keys, and every part the package left out. The answer was 201 `{agent, mode, version, backup?, sessions: {imported, skipped}}`.
- A `system_config.yaml` without `system_prompt` was laid over the template's config and checked as a config write.
- The Trace import was generalised to a Session's set of files: each landed in its date folder under its own index and was registered once; a Session id the install already had was skipped and reported.
- The snapshot import lost its version confirmation (409 `version_conflict`), and the create route its snapshot seed.

## CLI

- `penguin agent export <agent-id>` and `penguin agent import <file|directory>` were added. A directory is zipped under its own name with the zipper `penguin plugin install <dir>` uses, which moved to `zip-folder.ts`.

## Web App

- An Agent card gained an export icon and the settings Overview an **Export…** button. Both opened one export dialog: checkboxes for Skills, Hooks, Memory, Workbenches (with their data) and Schedules (off), the conversations as **None**, **Latest N** (20) or a **Date range**, and a line saying the vault never travels. **Export** saved the zip through the fetch-then-save download helper.
- The Agents page header gained **Import agent**. Its dialog had two ruled sections. **Migrate from another framework** took the framework (Claude Code, Codex, DeepSeek Harness, Qoder, Qwen Code, WorkBuddy or Other) and a path, folded the full prompt with copy, and **Open a new chat** put the prompt in a new conversation with the Project's default agent through the bridge **Create with AI** uses; it installed the `skill-porting` plugin on that agent first when the agent lacked the `agent-porting` Skill. **Import a file** took a `.zip` (or an older `.tar.gz`), prefilled the id from the file name, and uploaded the file as it is. A 409 `agent_exists` offered **Use another id** and, to the owner only, **Overwrite the existing agent** behind a danger confirmation. A landed import said what it did in a toast and read the Agent list again.
- The settings Overview's **Replace from file…** (owner only) opened the import dialog with the file section alone and **Replace**, behind the same confirmation. It replaced **Export snapshot** and **Import snapshot**, and the version-conflict prompt went with them.
- The create dialog lost **Initialize from a snapshot**; its footer pointed to **Import agent**.
- The ui-gallery's demo API answered the new archive download and import upload.

## Skill

- The `skill-porting` plugin gained `agent-porting`, instructions only. It said where Claude Code, Codex, DeepSeek Harness, Qoder, Qwen Code and WorkBuddy keep their instructions, Skills, commands, MCP servers, hooks, subagents and memory, and how each maps into the zip layout: instructions into `AGENTS.md`, Skills and commands into `skills/`, MCP servers into a `system_config.yaml` holding only the keys it changes with credentials as `${KEY}`, `command` hooks on `Stop`, `PreToolUse` and `UserPromptSubmit` into a hook package of wrapper scripts, and auto-memory into `memory/user/`. It read the source only, never copied a secret's value, searched its output for secrets before `penguin agent import <dir> --project-id <p>`, and reported the id, what mapped, what did not and why, and the vault keys to set.

## Docs

- The Server API, Agents, Self-Improvement and CLI pages describe the archive and import routes and the two commands.
- The Agents page describes the two dialogs and the migration, the Web App page the owner's part and the import dialog's two paths, and the Skills page's library table the `agent-porting` Skill.

## Compatibility

- A client of `GET …/agents/:agentId/export`, `POST …/agents/:agentId/import` or `POST …/agents` with `dataBase64` switches to `GET …/agents/:agentId/archive` and `POST …/agents/import`, sending the file as the body.
- `.tar.gz` snapshot packages exported before still import; see [backward compatibility](2026-11-09-backward-compatibility.md).
