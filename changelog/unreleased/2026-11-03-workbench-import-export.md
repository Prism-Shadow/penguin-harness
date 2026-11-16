# Workbenches import and export as zips

- **Date:** 2026-11-03
- **Type:** feature
- **Scope:** `server`, `web`, `ui-gallery`
- **PR:** [#1444](https://github.com/Prism-Shadow/penguin-harness/pull/1444)

[中文版](2026-11-03-workbench-import-export.zh.md)

A workbench's source can be downloaded as a zip and a zip can be imported as a workbench, the way Skills and hook packages already travel. The Agent settings Workbenches tab gained an 「Import zip」 button and a per-row 「Export」 icon; both are open to every member of the Project and go to the server the Agent lives on.

## Details

- `GET /api/projects/:p/agents/:a/workbenches/:id/archive` answers the workbench's source files under one top-level `<id>/` directory, named `<id>.zip`, or `<id>-v<version>.zip` when `package.json` has a `version`. It never carries `state.json`, a dot entry (`.build/`, `.harness/`, `.plugin.json`) or `node_modules/`, and it imports back unchanged. A folder over the Skill archive's caps answers 413 `workbench_too_large`.
- `POST /api/projects/:p/agents/:a/workbenches/archive` with `{ dataBase64, overwrite? }` takes `package.json` under exactly one top-level directory (whose name is the id) or at the zip root (where `package.json`'s `name` is the id; a scoped name is refused with the advice to use a directory). `package.json` must parse and list `penguin.modules`. Refused with 400 before anything is written, under the Skill archive's caps: `state.json` and `node_modules/` in any letter case, dot entries, unsafe paths, control characters, names Windows cannot hold, names git reserves, links, and two names that a disk ignoring letter case or Unicode normal form takes for one.
- An id whose folder already has a `package.json` answers 409 `workbench_exists` with `details.workbenchId`; an id that differs from a folder's only in letter case is that folder. With `overwrite: true` the source becomes exactly the archive's (stale source files are removed), `state.json` and `.plugin.json` are kept, and `.harness/` is removed so the load writes this host's types. The archive is checked against the folder and written out beside it first, so a refused overwrite, or one whose files the disk will not take, leaves the folder as it was; a staging folder that an interrupted import left behind is removed by a later import once it is over an hour old; a link, or a directory holding more than old source, in a new file's way answers 409 `workbench_conflict`. Imports into one Agent run one at a time. The workbench is loaded at once and the 201 answer is `{ workbench }`, the load's error included.
- The tab's import dialog asks before overwriting a taken id, naming it, and keeps the reason of a refused zip on screen; after an import, a toast says whether the workbench loaded, with the load's error when it did not. The component gallery answers both routes in its mock API.
