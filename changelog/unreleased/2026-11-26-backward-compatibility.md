# Backward compatibility in this batch

- **Date:** 2026-11-26
- **Type:** process
- **Scope:** `server`, `core`, `web`
- **PR:** [#1899](https://github.com/Prism-Shadow/penguin-harness/pull/1899)

[中文版](2026-11-26-backward-compatibility.zh.md)

Every compatibility decision of [the move to `@penguinharness/rsi-workbench`](2026-11-26-rsi-workbench-builtin.md) is recorded here once. All of it stays until the next major version (1.0) and is removed by whoever prepares 1.0.

## The in-repo workbench and the Benchmarks of a 0.2.19 or 0.2.20 Project

The first start of this build migrates every Project once (`packages/server/src/services/rsi-workbench-migration.ts`, run by the platform boot after the data root's layout migration and before any workbench loads). Each Project gets a row in web.db's new `project_data_migrations` table, begun before the first change and finished after the last, and a run that stops part-way is resumed at the next start from what is on disk. A Project this build creates is recorded at its creation and never migrated. The old shapes handled:

- **An Agent's `agent_state/workbenches/benchmark/` installed by `agent-evaluation`.** When its `index.ts`, `package.json` (its App Center switch aside) and `ui/icon.svg` are the ones `agent-evaluation` shipped (2026.11.24.1 or 2026.11.25.1), it is rewritten from the pinned package through the plugin installer: its receipt names `rsi-workbench`, its `.disabled` and `.hidden-from-sidebar` markers, its App Center switch, its `state.json` and its history stay, and its first load records the new files in the Agent State history. An edited copy is left as it is; its receipt is read as `rsi-workbench`'s (core's `state/workbench-owner-renames.ts`), so its plugin card offers the update, and the update writes the new receipt. Until then it draws nothing, as its `builtin` renderer is gone.
- **The Benchmarks in `projects/<p>/agents/system_agent/app/data/benchmark/`**, or in `projects/<p>/benchmarks/` where the Project's `system_agent` is an Agent of the user's: moved into `projects/<p>/agents/default_agent/app/data/benchmark/` by rename, with `.seeded` written so the workbench does not seed over them and `.harbor/` moved to `…/default_agent/app/cache/benchmark/harbor/`. A link (a directory junction on Windows) is left at the old place, so a stale installed Skill or toolkit copy, a conversation's `BENCHMARK_DIR` and an evaluation still writing its `.jobs/` keep reaching the same files; an unfinished trial is moved all the same, with one log line. A Benchmark whose id the target already holds stays where it is with a log line, the old folder is not replaced by a link, and the next start moves the rest. The 0.2.19 link at `projects/<p>/benchmarks` reaches the new place through the link left at the system Agent's folder.
- **A Project with no `default_agent`:** one is provisioned first, as a new Project's would be; when that fails, nothing is moved or recorded, a log line says why, and the next start tries again.
- **A default Agent without the `benchmark` workbench** (a Project from before 0.2.19, or one whose user removed it): `rsi-workbench` is installed on it once, through the same install an Agent's plugin page performs (its two Skills included), and recorded; removed afterwards, it is not installed again (decision E1).
- **Machines:** each machine migrates its own data root at its own first start on this build; the hub does nothing for them. Until a machine is upgraded, the workbench page reads that machine's old `/api/projects/:p/benchmarks` (in the package, until the machine upgrades or 1.0).

## Old `/benchmark` links

`/benchmark`, `/benchmark/<id>` and their query strings open the Self-Evolution Workbench's window at the same place (`/apps?app=<agent>/benchmark&at=…`, replacing the history entry): the default Agent's workbench, else another Agent's, else the App Center offers to install it on the default Agent (`packages/web/src/features/app-center/legacy-benchmark-redirect.tsx`).

## A copy installed from the plugin market before the upgrade

0.2.19 could already load this package. If an administrator installed `@penguinharness/rsi-workbench` from the plugin market before upgrading, that copy in `<root>/plugins` shadows the built-in one: new Projects do not get it preinstalled, and uninstalling it from the market is refused with `plugin_shipped`. The product owner accepted this (2026-11-26). To remove it: stop the server, delete `<root>/plugins/node_modules/@penguinharness/rsi-workbench` and its line in `<root>/plugins/package.json`, and start the server again.

## Scope

Every data root this build opens with a server: a server's, the desktop app's, a development root, and each machine's at its next start on this build. An SDK program or the CLI without a server does not run it; the next server start does.

## What you need to do

Nothing, except removing a market copy as above, and moving a same-id Benchmark that a log line names.

## Lifetime

Until 1.0. Whoever prepares 1.0 removes `services/rsi-workbench-migration.ts` with its calls in `hmr/platform.ts` and `ProjectService`, the `project_data_migrations` table with its repo (and a migration that drops it), core's `state/benchmark-dirs.ts`, `state/workbench-owner-renames.ts` and the layout helpers core exports for the migration, the `/benchmark` redirect, the package's fallback to a machine's old routes, and the links left at the old places. After that a stale path under the system Agent's folder no longer resolves, and an edited in-repo workbench copy is a workbench of no plugin.
