# Backward compatibility: the resident ssh machine kind

- **Date:** 2026-09-27
- **Type:** process
- **Scope:** `server`, `plugins`
- **PR:** [#855](https://github.com/Prism-Shadow/penguin-harness/pull/855)

[中文版](2026-09-27-backward-compatibility.zh.md)

## `machine-ssh` loads whatever the Projects list

Which plugins a server loads is each Project's configuration (`[plugins]` in `.project_config.toml`). Machines were ssh before machine kinds were plugins, and no Project lists `@prismshadow/penguin-plugin-machine-ssh`. Under that rule alone, every ssh machine a deployment uses would stop being reachable until someone enabled a plugin nobody knew was needed.

So the server has one **resident** plugin, `RESIDENT_PLUGINS` in `packages/server/src/plugin/loader.ts`: it is loaded first on every server, whether or not a Project lists it. It is in no Project's list, so syncing a Project's plugins to its machines neither sends it nor removes it; each machine loads it by the same rule, from its own build. If it fails to load, it is reported and skipped like any other plugin: the server comes up, and ssh machines show as **kind unavailable** until the next push fixes it. The server's own hot push (`/api/hmr`) does not go through a machine and is unaffected.

Where: every server. Nothing to do by hand; existing `ssh:<alias>` records, the `/server/<machineId>/…` proxy and Project memberships all stay as they are.

## Compatibility

The resident rule stays for as long as ssh is a plugin; it has no removal date. It is a general mechanism with one entry. Adding a second resident plugin changes what every server loads, and needs its own review and its own entry here.
