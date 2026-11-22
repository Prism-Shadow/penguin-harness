# @prismshadow/penguin-library-setting

The settings domain as a library package — #255's restack, step L02.

## What lives here

- `src/settings.ts` — the two mechanism contracts: `Settings` (the admin-level
  key-value store with its typed readers/writers and the write watcher) and
  `UiPrefsStore` (per-user free-form JSON preferences). Declared apart from
  what implements them.
- `src/attachment-limits.ts` — the one place every attachment size number is
  defined; the per-file, per-request and body caps are derived from one
  another here. Pure arithmetic, no dependencies — it lives with the settings
  because the caps it derives ARE settings.
- `src/plugin-module-requests.ts` — the `PluginModuleRequests` contract and
  its row: who asked this server to run a plugin's server module, and what an
  administrator decided (PRFC-0031).
- `src/repos/` — `ServerSettingsRepo` (implements `Settings`),
  `UiPrefsRepo` (implements `UiPrefsStore`) and `PluginModuleRequestsRepo`
  (implements `PluginModuleRequests`): the `server_settings`, `ui_prefs` and
  `plugin_module_requests` tables. Each takes the `Db` capability from
  `@prismshadow/penguin-library-db`.
- `src/plugin-module-preinstalls.ts` and its repo — the
  `PluginModulePreinstalls` contract over the `plugin_module_preinstalls`
  table: the preinstalled built-in modules this server has handled for each
  Project (PRFC-0030). The server also builds the repo with `wire`, outside a
  tree: the one-time listing runs while a generation boots, before its module
  tree exists.

## The dependency rule

This package depends on `@prismshadow/penguin-core` (the kernel's
`@Interface`/`@Component` markers) and `@prismshadow/penguin-library-db`
(the `Db` capability) — nothing else. `packages/server` imports this package;
nothing here imports the server. The server's platform tree wires the repos
as children of its settings module and re-exports the mechanisms; this
package only decides where the code lives.
