# Every plugin quick-starts, and nothing runs before you send

- **Date:** 2026-09-14
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `plugins`, `docs`
- **PR:** pending

[中文版](2026-09-14-plugin-quick-start.zh.md)

Quick start on the Plugins page used to exist only for a library plugin with a skill already
installed on the current Agent. Every plugin has one now, and it is a demo: a prompt that shows the
plugin working once sent.

- **A draft, never a run.** Quick start opens a new-chat draft on the current Agent with the demo
  filled in (per UI language), its skills pre-selected and goal mode on where the demo asks for
  them; a demo naming a surface opens that surface's draft with the prompt in its first line. No
  model is called and no token is spent until you send it (or open the surface).
- **Installed first, after asking.** A library plugin the current Agent lacks is installed on it
  after a confirmation; a module plugin the Project does not list goes through the existing
  install confirmation, and the draft opens once it runs. A module plugin waiting for a restart or
  failed to load cannot quick-start, and says why.
- **Declared by each plugin.** A library plugin declares `quick_start` in its `plugin.json`
  (`prompt`, `prompt_zh`, `skills`, `goal`); a module plugin contributes to `WebModule.quickStarts`
  (`prompt`, `promptZh`, `surface`), listed on `GET /api/contributions` by module. Every builtin
  plugin declares one — the sandbox backends test what their confinement denies, the languages
  plugin prints its five languages, Claude Code opens its surface, the goal plugin starts a small
  goal. A third-party plugin that declares none gets its first skill, or a generic demo prompt.
