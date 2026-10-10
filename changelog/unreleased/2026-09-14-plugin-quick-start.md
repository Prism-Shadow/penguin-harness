# Every library plugin quick-starts, and nothing runs before you send

- **Date:** 2026-09-14
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `plugins`, `docs`
- **PR:** [#726](https://github.com/Prism-Shadow/penguin-harness/pull/726)

[中文版](2026-09-14-plugin-quick-start.zh.md)

Quick start on the Plugins page used to exist only for a library plugin with a skill already
installed on the current Agent. Every library plugin has one now, and it is a demo: a prompt that
shows the plugin working once sent.

- **A draft, never a run.** Quick start opens a new-chat draft on the current Agent with the demo
  filled in (per UI language), its skills pre-selected and goal mode on where the demo asks for
  them. No model is called and no token is spent until you send it.
- **Installed first, after asking.** A plugin the current Agent lacks is installed on it after a
  confirmation, and the draft opens once it is.
- **Declared by each plugin.** A library plugin declares `quick_start` in the `penguin` block
  of its `package.json` (`prompt`, `prompt_zh`, `skills`, `goal`), listed on `GET /api/plugins`. Every builtin library
  plugin declares one — the goal plugin starts a small goal. A third-party plugin that declares
  none gets its first skill.
