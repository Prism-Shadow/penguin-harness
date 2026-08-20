# penguin-sdk skill: explicit trigger and CLI-first tool wiring

- **Date:** 2026-08-20
- **Type:** process
- **Scope:** `skills`, `docs`
- **PR:** [#365](https://github.com/Prism-Shadow/penguin-harness/pull/365)

[中文版](2026-08-20-penguin-sdk-skill-trigger.zh.md)

Sharpened when the `penguin-sdk` skill fires and what it recommends for wiring in the
user's own tools.

## Details

- The skill's `description` now opens with the trigger: use the skill whenever the user
  wants to build an agent, AI app, or any agentic application.
- Added a "Wiring in the user's tools" section: integrate the user's existing tools as
  CLI commands the embedded agent invokes through the built-in `exec_command` tool,
  reserving MCP servers (`tools.mcpServers` in `system_config.yaml`) for integrations a
  CLI wrapper cannot express.
- Extended `short_description` / `short_description_zh` and the bilingual docs skill
  tables to name agent building, and bumped the skill version to 20.
