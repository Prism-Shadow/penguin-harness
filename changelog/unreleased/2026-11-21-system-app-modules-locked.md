# A server module behind a system app cannot be stopped

- **Date:** 2026-11-21
- **Type:** feature
- **Scope:** `server`, `web`, `core`, `docs`
- **PR:** [#1678](https://github.com/Prism-Shadow/penguin-harness/pull/1678)

[中文版](2026-11-21-system-app-modules-locked.zh.md)

A built-in plugin whose card says `preinstall: true`, and whose server module declares a system app in the new data slot `SystemAppModule.apps`, can no longer be stopped or taken out of a Project ([PRFC-0036](https://github.com/Prism-Shadow/penguin-harness-design/pull/503)). The slot's data is `{ app }`, the key of the page the module contributes for that app. No plugin shipped in this version declares one.

## Details

- The server reads the declaration from the package's `ifaces.json` and imports nothing. `SystemAppModule` joined the platform tree, so a module's contribution to the slot is accepted at boot. `SystemAppData`, `SystemApps` and `SystemAppsSlots` are exported from `@prismshadow/penguin-server/plugin`, and core exports `slotEntries`, which reads one slot's entries off a package's table.
- The administrator's stop, `POST /api/admin/plugin-modules/decide` with `decline`, answers `409` `system_app_module_locked`.
- A plugin-table write that would take such a module out of what this server runs for a Project answers the same `409` and writes nothing. This covers `PUT` and `DELETE` on `/api/projects/:projectId/plugins/installed`, from the shared table or from this server's own. A write that changes only another machine's own table is left to that machine.
- Every boot of a generation lists the module again in this server's own `[plugins.<machineId>]` table of each Project whose config lacks it, before the plugin closure is read. Unlike other preinstalled modules, a removal by hand does not stick. A ledger row an administrator declined before the module provided a system app is enabled again by the system, as `builtin`.
- `GET /api/admin/plugin-modules` marks such a row `systemApp: true`. Under server module requests in Settings › Plugins, its row reads "System app, built in" and offers no Stop. A preinstalled module's row no longer says its Project was deleted, since it belongs to every Project.
- The docs state the rule where they describe removing a server plugin and the `[plugins]` table.
