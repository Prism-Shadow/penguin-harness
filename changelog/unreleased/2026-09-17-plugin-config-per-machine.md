# Plugin settings can be edited on each machine

- **Date:** 2026-09-17
- **Type:** feature
- **Scope:** `web`
- **PR:** [#450](https://github.com/Prism-Shadow/penguin-harness/pull/450)

[中文版](2026-09-17-plugin-config-per-machine.zh.md)

The Plugins page of the Settings dialog gained a machine picker. It appears once the Project holds a connection to another machine. Picking a machine reads, saves and runs actions on that machine's own plugin settings through `/server/<machineId>/api/admin/plugin-config`. Each server keeps its settings in its own database, and nothing is copied between machines. A machine that cannot answer shows an empty page with the reason.
