# A workbench's own folders: data, cache and state

- **Date:** 2026-11-17
- **Type:** feature
- **Scope:** `core`, `server`, `plugins`, `docs`
- **PR:** [#1579](https://github.com/Prism-Shadow/penguin-harness/pull/1579)

[中文版](2026-11-17-workbench-data.zh.md)

`WorkbenchHost.dataPaths()` returns three folders of the workbench's own:

- `dataDir`, `<agentDir>/app/data/<workbenchId>/`, for files it shares with its Agent;
- `cacheDir`, `<agentDir>/app/cache/<workbenchId>/`, for what can be made again;
- `stateDir`, a short path under `<root>/run/`, for sockets, pipes and locks.

A workbench's server code is now type-checked with Node's declarations, so its handler reads and writes these folders with `node:fs` and serves its own routes. The data folder travels in the Agent export with the workbench's data, and all three folders are removed with the workbench. New Project, Agent, Skill, hook package and workbench ids may no longer be a name Windows reserves; ids already on disk keep opening.

## Details

- **`dataPaths()`** creates all three folders before it returns. It refuses a link or a file wherever one of them, or a level above it below the Agent's directory or the data root, belongs.
- **`socketPath(name)`** returns `<stateDir>/<name>`. It throws, naming the limit, when that path would pass the 103 bytes a Unix socket path holds (macOS allows 104 with the terminator, Linux 108). On Windows it returns a named pipe, `\\.\pipe\penguin-<hex>-<name>`.
- **`stateDir`** sits at `<root>/run/<project>/<agent>/<workbench>/`, each level a 10-character hash of its id, so a socket path stays short however deep the Agent's folder is. It is never exported, and it goes when its workbench, Agent or Project is removed.
- **Node types:** the workbench compile now includes `@types/node` and no other `@types` package. `@types/node` became a runtime dependency of the server, and the desktop build and the hot push carry it beside the compiler.
- **Sandbox:** under `workspace-write`, an Agent's commands may write `<agentDir>/app` and its `<root>/run/…` folder once each exists as a real directory. Starting a command never creates either.
- **Export and import:** the Agent export's **With their data** (`workbenchData`) carries each carried workbench's `app/data/<id>/`, never its cache or state. An overwrite import:
  - replaces the data folder of each workbench the package brings data for;
  - keeps the folder of a workbench it brings none for;
  - removes the data, cache and state of a workbench the new State no longer has.

  The pre-import backup holds every data folder the import replaces or removes.
- **Removal:** removing a workbench, or uninstalling the plugin it came from, removes its three folders. Deleting an Agent or a Project removes its `run/` folder.
- **New ids:** creating a Project, an Agent or an organization refuses `con`, `prn`, `aux`, `nul`, `com1`–`com9` and `lpt1`–`lpt9` (with or without an extension) and any name ending in a dot. So do importing a Skill, a hook package or a workbench under a new name, and installing a plugin workbench into a new folder. The rules that read ids are unchanged, so an existing Agent named `aux` or a workbench named `report.v2` still opens.
- **Docs:** the `penguin-plugin` Skill (2026.11.19.2), the workbench's `.harness/README.md`, the CLI's `--no-workbench-data` help and the docs pages describe the folders.
