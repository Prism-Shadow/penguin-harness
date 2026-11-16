# Uninstall a whole plugin from an Agent on the server, and switch workbenches on and off

- **Date:** 2026-11-05
- **Type:** feature
- **Scope:** `server`, `core`
- **PR:** [#1496](https://github.com/Prism-Shadow/penguin-harness/pull/1496)

[中文版](2026-11-05-agent-plugin-uninstall-and-workbench-switches.zh.md)

The server half of penguin-harness-design [#430](https://github.com/Prism-Shadow/penguin-harness-design/pull/430) (PRFC-0025). A new route uninstalls every part a plugin put on an Agent in one request, and every workbench gained an on/off switch of its own beside an Agent-wide one. Folders without a switch marker run as before.

## Uninstalling a plugin

- `DELETE /api/projects/:p/agents/:a/plugins/:name` (owner only) removes, in order, the workbenches whose install receipt names the plugin, its MCP servers (the `tools.mcpServers` entries carrying its name, in one write of `system_config.yaml`), its hook package `agent_state/hooks/<name>/`, and every Skill whose name the library plugin contributes. A plugin that has left the library takes no Skill with it. Each workbench is removed the way `DELETE …/workbenches/:id` removes one, so the removal is recorded in its history.
- The answer is `{ removed: { skills, hooks, mcpServers, workbenches } }`. A part that fails is listed in `failed` with the reason, and the other parts are still removed. When the Agent has no part of the plugin, the answer is 404 `plugin_not_installed`. The Agent's runtimes are invalidated once, at the end.
- Core gained `uninstallPluginMcpServers`, which removes a plugin's entries from `tools.mcpServers` and keeps the user's entries and the file's comments.

## Workbench switches

- An empty `agent_state/workbenches/<id>/.disabled` turns that workbench off, and `agent_state/workbenches/.disabled` turns off every workbench of the Agent. A workbench runs only while both are absent. `PUT …/workbenches/:id/enabled` and `PUT …/workbenches/enabled` (owner only, `{ enabled }`) set them. They unload or load what they cover at once, and the Project's users hear `workbench_updated`.
- A workbench that is off is never loaded, by a listing, the folder watcher or a request. Unloading ends its subscriptions with its tree. Its pages, the page runtime, the page SDK, its API and a reload answer 409 `workbench_disabled`. History, export and removal work as before. A rollback restores the files without loading them, and an archive import writes the source and leaves the workbench unloaded.
- `GET …/workbenches` lists every workbench with its own `enabled` and adds the Agent-wide `enabled`. A workbench that is off is listed from its folder: its source `revision` and `uiRev`, no `tabs` or `hints`, `error: null` and `loadedAt: null`. `WorkbenchInfo.loadedAt` became `string | null` for this.
- The markers are dot entries, so a plugin update, a reinstall and an archive import with `overwrite` keep them. They stay out of a workbench's versions and its zip export.
