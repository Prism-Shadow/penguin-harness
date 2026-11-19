# Preinstalled built-in plugin modules are listed in Project config

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `server`, `db`, `docs`

[中文版](2026-11-19-preinstalled-plugin-modules.zh.md)

A built-in plugin whose card says `preinstall: true` now has its server modules listed in every Project ([PRFC-0030](https://github.com/Prism-Shadow/penguin-harness-design/pull/491)). A new Project lists them in its own `[plugins.<machineId>]` table. The first time a server boots a build that ships such a plugin, it lists the plugin once in every Project it already has, and records that per plugin. After that the tables are the administrator's: a removal is never undone by a later boot. Projects created before this version are handled by a one-time migration; see [backward compatibility](2026-11-19-backward-compatibility.md).

## Details

- A preinstalled module is built in (the package resolves from a prefix the running build ships and only adds modules), ships server modules, and its card sets `preinstall` to `true` explicitly. An absent `preinstall` still preinstalls the plugin's Agent content, but no longer counts for its server modules. No plugin shipped in this version declares it, so nothing is listed yet. The sandbox backends say `false`, so they are never listed.
- Project creation lists the preinstalled modules as its last step:
  - `POST /api/projects`;
  - a new user's own Project;
  - the first administrator's `default_project`, including one the CLI created earlier;
  - a Project a hub creates on a machine through config sync.

  The Project's table is written once for all of them. The App re-assembles once, and only when no Project listed one of them yet. A module the administrator stopped is passed over. A failure is logged and never fails the creation.
- The one-time listing runs on every boot of a generation, after the database migrations and before the plugin closure is read. That generation therefore loads the module with no re-assembly of its own. It writes only this server's own table, skips a Project that lists the package already, logs one line per Project it changes, and skips a module the administrator stopped.
- A new web.db table, `plugin_module_preinstalls` (migration `2026-11-19-plugin-module-preinstalls`, swap-safe), records one row per package listed this way.
- The listing also seeds the package's `plugin_module_requests` row: enabled, `builtin`, by nobody, for no Project. The administrator therefore sees the module under server module requests and can stop it. Stopping works as before: the module leaves every Project's own table, and new Projects and boots no longer list it. Enabling a stopped preinstalled module lists it in every Project's own table again, in one change.
- Each server judges by its own build and writes only its own table. A hub never writes a machine's table, and the config sync leaves machine tables alone.
