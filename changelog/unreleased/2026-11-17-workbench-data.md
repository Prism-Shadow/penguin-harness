# A workbench's own folders at the agent, server and machine levels

- **Date:** 2026-11-17
- **Type:** feature
- **Scope:** `core`, `server`, `plugins`, `docs`
- **PR:** [#1579](https://github.com/Prism-Shadow/penguin-harness/pull/1579)

[中文版](2026-11-17-workbench-data.zh.md)

`WorkbenchHost.dataPaths(level?)` returns three folders of the workbench's own, `{ dataDir, cacheDir, stateDir }`, for files kept for good, files that can be made again, and sockets, pipes and locks. The level says who shares them:

- `agent`, the default: this Agent's copy of the app;
- `server`: every copy of the same plugin's workbench on this data root, across its Projects;
- `machine`: every PenguinHarness of this OS user on this computer.

A workbench's server code is now type-checked with Node's declarations, so its handler reads and writes these folders with `node:fs` and serves its own routes. The agent-level data folder travels in the Agent export with the workbench's data, and the agent-level folders are removed with the workbench. New Project, Agent, Skill, hook package and workbench ids may no longer be a name Windows reserves; ids already on disk keep opening.

## Details

- **Where each level lives:**
  - agent: `<agentDir>/app/{data,cache}/<workbenchId>/`, with its state at `<root>/run/<project>/<agent>/<workbench>/`, each level a 10-character hash of its id;
  - server: `<root>/app/{data,cache}/<plugin>/<workbenchId>/`, with its state at `<root>/run/server/<hash>/`;
  - machine: `~/.penguin/machine/{data,cache}/<plugin>/<workbenchId>/` (`PENGUIN_MACHINE_HOME` names another place), with its state at `run/<hash>/` below it.
- **Shared levels:** only a workbench installed from a plugin has a server or machine level. One made in place gets an error naming the agent level instead.
- **A Project called `app` or `run`:** where an older Project holds one of those names, the host makes no workbench folder inside its folder. A request whose folders would fall there throws and says why: `app` covers the server level's data and cache, `run` the agent and server levels' state and socket paths. The machine level is unaffected.
- **Folder creation:** `dataPaths()` creates the level's three folders before it returns. It refuses a link or a file wherever one of them belongs, or wherever any level above it, up to its base, belongs.
- **`socketPath(name, level?)`** returns `<stateDir>/<name>`. It throws, naming the limit, when that path would pass the 103 bytes a Unix socket path holds (macOS allows 104 with the terminator, Linux 108). On Windows it returns a named pipe, `\\.\pipe\penguin-<hex>-<name>`.
- **Node types:** the workbench compile now includes `@types/node` and no other `@types` package. `@types/node` became a runtime dependency of the server, and the desktop build and the hot push carry it beside the compiler.
- **Sandbox:** under `workspace-write`, an Agent's commands may write the agent level, `<agentDir>/app` and its `<root>/run/…` folder, once each exists as a real directory. They may not write the server or machine level. Starting a command never creates any of them.
- **Export and import:** the Agent export's **With their data** (`workbenchData`) carries each carried workbench's agent-level `app/data/<id>/`, never its cache, its state or a shared level. An overwrite import:
  - replaces the data folder of each workbench the package brings data for;
  - keeps the folder of a workbench it brings none for;
  - removes the agent-level data, cache and state of a workbench the new State no longer has.

  The pre-import backup holds every data folder the import replaces or removes.
- **Removal:**
  - Removing a workbench, or uninstalling the plugin it came from, removes its agent-level folders.
  - Deleting an Agent or a Project removes its `run/` folder.
  - The server and machine levels are never removed with a workbench, an Agent or a Project.
- **New ids:** creating a Project, an Agent or an organization refuses `con`, `prn`, `aux`, `nul`, `com1`–`com9` and `lpt1`–`lpt9` (with or without an extension) and any name ending in a dot. So do importing a Skill, a hook package or a workbench under a new name, and installing a plugin workbench into a new folder. A new Project may also not be called `app` or `run`, the data root's own folders for workbenches. The rules that read ids are unchanged, so an existing Agent named `aux`, a workbench named `report.v2` or a Project named `app` still opens.
- **Docs:** the `penguin-plugin` Skill (2026.11.19.3), the workbench's `.harness/README.md`, the CLI's `--no-workbench-data` help and the docs pages describe the folders and their levels.
