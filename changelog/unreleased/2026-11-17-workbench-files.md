# Workbenches: a folder of files the workbench and its Agent both write

- **Date:** 2026-11-17
- **Type:** feat
- **Scope:** `server`, `core`, `skills`, `docs`
- **PR:** [#1579](https://github.com/Prism-Shadow/penguin-harness/pull/1579)

[中文版](2026-11-17-workbench-files.zh.md)

A workbench's handler can read and write files in `.files/`, a folder inside the workbench's own folder that its Agent edits with its file tools too. `WorkbenchHost` gains `listFiles()`, `readFile(path)`, `writeFile(path, data)`, `removeFile(path)` and `filePath(path?)`, so a document the user edits in the page and asks the Agent to change is one file on disk, and whichever side wrote last is what the other reads next. The AI PPT workbench is the first to use it.

## Details

- `listFiles()` answers every regular file below `.files/` as `{ path, size, mtimeMs }`, sorted by path. `readFile(path)` answers `null` for a missing file. `writeFile(path, data)` takes a string or a `Uint8Array`, writes the file whole (staged beside it, then renamed in), creates its directories and answers the written file. `removeFile(path)` does nothing for a missing file. `filePath(path?)` is the file's (or, without a path, the folder's) absolute path on the server's machine, for a handler to name when it asks the Agent to edit the file.
- There is no watch method: a handler notices the Agent's writes by calling `listFiles()` on a timer while a page is connected and comparing `mtimeMs` and `size`.
- Nothing follows a link. A path whose file, or any directory above it inside the folder, is a symbolic link is refused, and a listing leaves links out. Paths are `/`-separated and stay inside the folder. A file is at most 50 MB, and a listing of more than 5,000 files throws.
- The folder is the workbench's data, not its source: a write loads nothing and records no version; a rollback, a plugin update and a workbench zip import leave it in place; removing the workbench deletes it with `state.json`.
- An Agent export carries `.files/` with each workbench's `state.json`, only when **With their data** (`workbenchData`) is on. An overwrite import whose package carries a workbench without `.files/` keeps the current one, as it keeps `state.json`. A plugin install may take a workbench folder that holds only `state.json` and `.files/`. The git exclude file of a newly created `agent_state.git` lists `workbenches/*/.files/`.
- The generated `.harness/README.md` gains a "Files shared with the Agent" section and keeps uploads in `.files/`. A `.harness/plugin.d.ts` written before this change has no `listFiles`: delete `.harness/` to take the new types.
- The `penguin-plugin` Skill (`2026.11.17.1`) gains a "Files shared with the Agent" section, lists the five members with the host's others, and stores uploads with the host's files instead of in the scratchpad. The Workbench plugins, Agents, server API and Sessions and Traces docs pages and the CLI's `--no-workbench-data` help describe the folder.
- Design: [penguin-harness-design#468](https://github.com/Prism-Shadow/penguin-harness-design/pull/468) (PRFC-0028).
