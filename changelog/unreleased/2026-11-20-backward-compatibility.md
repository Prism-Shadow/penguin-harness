# Backward compatibility in this batch

- **Date:** 2026-11-20
- **Type:** process
- **Scope:** `core`, `server`, `desktop`, `plugins`
- **PR:** [#1641](https://github.com/Prism-Shadow/penguin-harness/pull/1641), [#1669](https://github.com/Prism-Shadow/penguin-harness/pull/1669)

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

## Project folders at the data root's top level, and Benchmarks in `<project>/benchmarks/`

[Projects moved under `projects/`](2026-11-20-data-root-projects.md), and Benchmarks into the Evaluation Center's data folder. The product owner chose a one-time migration that leaves links (2026-11-19). The old shapes still supported:

- a Project folder at `<root>/<project_id>/`: moved to `<root>/projects/<project_id>/` at the next start, and any such folder an older build makes after a downgrade is moved by the start after that;
- Benchmarks at `<project>/benchmarks/<benchmark_id>/`: moved to `<project>/agents/system_agent/app/data/benchmark/<benchmark_id>/`, except in a Project whose `system_agent` is an Agent of the user's ([2026-11-19](2026-11-19-backward-compatibility.md)), where they stay and are read from there;
- an absolute path recorded under an old place, in a Trace, an open conversation, a stale installed Skill copy or a file the migration did not rewrite: it still reaches the same files through the link left at each old place (a relative symbolic link on POSIX, a directory junction on Windows);
- web.db rows naming a path under an old place: rewritten by the server, also after an SDK run moved the folders without it.

An older build run on a migrated root lists its Projects from web.db and opens them through the links. Two of its listings read the data root's folders and skip links, so for a moved Project it loads no server-module plugin listed only in that Project's `[plugins]`, and adopts none of its unregistered Trace sessions. A Project named `app` or `run` keeps a link at the top level, so on that data root the workbench folders shared at the server level stay unavailable until the links go.

### Scope

Every data root a new build opens: a server's, the desktop app's, a development root, each machine's when its server next starts on the new build, and an SDK program's or the CLI's.

### What you need to do

Nothing, unless a Project is named `projects`: the server then does not start, and nothing is moved. Start the previous version, move that Project's Agents to another Project (export, then import), delete the `projects` Project, and start this version again.

### Lifetime

The owner of core's `state/layout-migration/` keeps the migration, its callers (the server's `layout/` and the platform boot, the SDK's `createAgent`, the CLI's `resolveProjectRoot`), the C1 branch of `resolveBenchmarksDir`, the link refusal in the workbench host's `data-dirs.ts` and the links themselves until the next major version (1.0). That release's preparation removes them together, and its migration step deletes the links; after it, a Trace's old path no longer resolves.
