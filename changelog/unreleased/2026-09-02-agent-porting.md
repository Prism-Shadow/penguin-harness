# Agents move between installs and tools as a portable bundle

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `server`, `cli`, `web`, `skills`, `docs`
- **PR:** [#594](https://github.com/Prism-Shadow/penguin-harness/pull/594)

[中文版](2026-09-02-agent-porting.zh.md)

An Agent can now be exported as a portable bundle and imported from one — or from a setup written for another coding agent. The bundle carries the Agent's definition, its installed skills and hook packages, and an integration guide written for a coding agent; it never carries vault values, memory, Traces, schedules or snapshots. This is a second path beside the Agent State snapshot: a snapshot backs up and restores one existing Agent's state, a bundle ports an Agent's identity and capabilities.

## Details

- `GET /api/projects/:p/agents/:a/bundle` (any member) downloads `<agentId>-export.zip`: `penguin-agent.json` (`format: "penguin-agent/1"` — id, name, description, the AGENTS.md instructions as `prompt`, the system-prompt template, skill and hook references, enabled built-in tool names, MCP Server entries with credential-looking `env` / `headers` values blanked, model preferences, vault key names, the export time and source), the installed `skills/<name>/` and `hooks/<name>/` directories, `README.md` (what the Agent is, the four server API calls that run it with the Project and Agent ids filled in, the CLI commands, its skills and tools, its limits), `api/ENDPOINTS.md`, and `examples/curl.sh` / `client.py` / `client.ts` — runnable clients that create a Session, send a task and print the final answer.
- `POST /api/projects/:p/agents/import` (any member) creates an Agent from such a bundle or from a bare `penguin-agent.json` (`{dataBase64, agentId?}`; the server tells the two apart by content): name, description, instructions, template, model preferences and MCP entries are applied, the bundled skills and hook packages installed, and the named built-in tools selected from the default toolset. A taken id is 409 `agent_exists`, a malformed bundle 400, and a failure part-way removes the half-built Agent. The response lists what was installed, what the definition named but the import could not apply, and the vault keys to set.
- `penguin agent export <agent-id> [--out <file|dir>]` writes the bundle and prints its path; `penguin agent import <file.zip|penguin-agent.json> [--agent-id <id>]` creates the Agent and reports the outcome. Both take `--project-id`, `--json` and `--server`.
- The Agents page's header gained **Import agent** — a dialog with **From a file** (the bundle or a bare definition, the id prefilled from the file name; a taken id is answered in place for a retry) and **Let AI import** (the Create-with-AI panel with examples for a local Claude Code, Codex or Pi setup and for an exported bundle, and a fixed tail that names the `agent-porting` skill and the target Project). Each card gained **Export agent**, and the settings overview shows the same export beside the snapshot pair, named apart from it.
- The `agent-development` plugin (version `2026-09-02.2`) gained the `agent-porting` skill: where to read a Claude Code (`~/.claude`, a repository's `.claude/`, `CLAUDE.md`, `.mcp.json`), Codex (`~/.codex/config.toml`, `AGENTS.md`, `~/.agents/skills`) or Pi (`~/.pi/agent/`) setup, how each part maps onto the definition (instructions to `prompt`, commands and prompts to skills, MCP servers, straightforward script hooks to hook packages, permission lists reported as unsupported), how to write the definition and run the import, and how to hand the exported bundle to a coding agent or publish the Agent as an HTTP API.
- The CLI, Web App, server API and skills docs describe the commands, the dialog, the routes and the skill in both languages.
