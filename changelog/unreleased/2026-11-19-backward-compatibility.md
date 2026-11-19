# Backward compatibility in this batch

- **Date:** 2026-11-19
- **Type:** process
- **Scope:** `server`, `db`
- **PR:** [#1642](https://github.com/Prism-Shadow/penguin-harness/pull/1642)

[中文版](2026-11-19-backward-compatibility.zh.md)

Every compatibility decision of this batch is recorded here once; the feature entries reference this file instead of re-telling it.

## Projects created before a module was preinstalled

[Preinstalled built-in modules are listed in Project config](2026-11-19-preinstalled-plugin-modules.md). A new Project lists them when it is created. A Project created earlier has no such listing. Without handling, once a feature moves into a preinstalled plugin, it would be missing from every Project that predates the move. The first boot of a build that ships a preinstalled module lists the module once in this server's own `[plugins.<machineId>]` table of every existing Project. Nothing else in the file changes. Each Project is recorded per package in web.db's `plugin_module_preinstalls`, and a recorded Project is never listed again. A Project the administrator later takes the module out of stays without it.

### Scope

Every `.project_config.toml` under the data root of a server that boots a build shipping a preinstalled module, once per package. A server whose build ships none changes nothing. A module the administrator stopped is not listed. A Project whose config cannot be read or written is logged and tried again at the next boot. One whose config is not valid TOML is logged and passed over for good.

### What you need to do

Nothing.

### Lifetime

The one-time listing stays until the next major version (1.0). Whoever prepares 1.0 removes it:

- `packages/server/src/services/preinstall-once.ts` and its call in `packages/server/src/hmr/platform.ts`;
- the record calls of Project creation and of the preinstalled enable in `packages/server/src/services/plugin-modules.ts`;
- `PluginModulePreinstalls` and `PluginModulePreinstallsRepo` in `library/setting`;
- the `plugin_module_preinstalls` table, through a new migration that drops it.

Listing at Project creation is the feature itself and stays. At that point it is also to be decided whether a module first preinstalled after 1.0 should still reach existing Projects; that would keep the mechanism as a standing one.
