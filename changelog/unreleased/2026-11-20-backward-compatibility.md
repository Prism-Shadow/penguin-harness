# Backward compatibility in this batch

- **Date:** 2026-11-20
- **Type:** process
- **Scope:** `server`, `plugins`
- **PR:** [#1641](https://github.com/Prism-Shadow/penguin-harness/pull/1641)

[中文版](2026-11-20-backward-compatibility.zh.md)

Every compatibility decision of this batch is recorded here once; the feature entries reference this file instead of re-telling it.

## Projects created before storage was a preinstalled module

[Settings › Storage](2026-11-19-storage-settings.md) comes from the preinstalled `storage` plugin. Its server module reaches existing Projects through the one-time listing that [preinstalled built-in modules](2026-11-19-preinstalled-plugin-modules.md) bring, described in [the 2026-11-19 file](2026-11-19-backward-compatibility.md#projects-created-before-a-module-was-preinstalled). This batch adds no code to it. It adds one more package that the listing writes: the first boot of a build that ships `storage` lists `"@penguinharness/storage" = "*"` once in this server's own `[plugins.<machineId>]` table of every existing Project. Without the listing, the page would be missing from every Project that predates the move.

### Scope

Every `.project_config.toml` under the data root of a server that boots a build shipping `storage`, once. A Project the administrator later takes the module out of stays without it, and so does a server where an administrator stopped the module.

### What you need to do

Nothing.

### Lifetime

As the listing itself: until the next major version (1.0), removed with it by whoever prepares 1.0 (see the 2026-11-19 file). Nothing here is removed on its own.
