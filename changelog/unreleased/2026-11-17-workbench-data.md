# A workbench's data folder, shared with its Agent

- **Date:** 2026-11-17
- **Type:** feature
- **Scope:** `core`, `server`, `plugins`, `docs`
- **PR:** [#1579](https://github.com/Prism-Shadow/penguin-harness/pull/1579)

[中文版](2026-11-17-workbench-data.zh.md)

Each workbench got a data folder of its own, `<agentDir>/app/data/<workbenchId>/`, beside the Agent State. The handler reads and writes it through typed host members, and the Agent edits the same files with its own file tools. The folder travels in the Agent export with the workbench's data and is removed with the workbench. New Project, Agent, Skill, hook package and workbench ids may no longer be a name Windows reserves; ids already on disk keep opening.

## Details

- `WorkbenchHost` gained `listFiles()`, `readFile(path)`, `writeFile(path, data)`, `removeFile(path)` and `filePath(path?)` over the data folder, and `dataPaths()` returning `{ dataDir, cacheDir }`, rendered into each workbench's `.harness/plugin.d.ts`. Paths stay inside the folder, and no link is followed anywhere from `<agentDir>/app` down. A file is at most 50 MB, a listing at most 5,000 files, and a write is staged and then renamed in. `dataPaths()` and `filePath()` create the data folder before handing out its path.
- Under a `workspace-write` sandbox, an Agent's commands may write `<agentDir>/app` once it exists as a real directory; a spawn never creates it.
- The Agent export's **With their data** (`workbenchData`) carries each carried workbench's `app/data/<id>/`, never its cache. An overwrite import replaces the data folder of each workbench the package brings data for, keeps the one it brings none for, and removes the data and cache of a workbench the new State no longer has; the pre-import backup holds every data folder it replaces or removes.
- Removing a workbench, or uninstalling the plugin it came from, removes its `app/data/<id>/` and `app/cache/<id>/`.
- Creating a Project, an Agent or an organization, importing a Skill, a hook package or a workbench under a new name, and installing a plugin workbench into a new folder refuse `con`, `prn`, `aux`, `nul`, `com1`–`com9` and `lpt1`–`lpt9` (with or without an extension) and a name ending in a dot. The rules that read ids are unchanged, so an existing Agent named `aux` or a workbench named `report.v2` still opens.
- The `penguin-plugin` Skill (2026.11.19.1), the workbench's `.harness/README.md`, the CLI's `--no-workbench-data` help and the docs pages describe the data folder.

## Reworked after review (2026-11-19)

The first version of this change offered only `dataPaths()`, with `project`, `server` and `machine` storage levels and a tightened id rule. The shared levels and the `env-paths` dependency were dropped, the typed file members came back, the data now travels with the Agent and goes with its workbench, and the Windows-name rule applies only when an id is created.
