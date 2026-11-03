# Workbenches import and export as zips

- **Date:** 2026-11-03
- **Type:** feature
- **Scope:** `server`, `web`, `ui-gallery`
- **PR:** [#1444](https://github.com/Prism-Shadow/penguin-harness/pull/1444)

[中文版](2026-11-03-workbench-import-export.zh.md)

A workbench's source can be downloaded as a zip and a zip can be imported as a workbench, the way Skills and hook packages already travel. The Agent settings Workbenches tab gained an 「Import zip」 button and a per-row 「Export」 icon; both are open to every member of the Project and go to the server the Agent lives on.

## Details

- `GET /api/projects/:p/agents/:a/workbenches/:id/archive` answers the workbench's source files under one top-level `<id>/` directory, named `<id>.zip`, or `<id>-v<version>.zip` when `package.json` has a `version`. It never carries `state.json`, a dot entry (`.build/`, `.harness/`, `.plugin.json`) or `node_modules/`, and it imports back unchanged. A folder over the Skill archive's caps answers 413 `workbench_too_large`.
- `POST /api/projects/:p/agents/:a/workbenches/archive` with `{ dataBase64, overwrite? }` takes `package.json` under exactly one top-level directory (whose name is the id) or at the zip root (where `package.json`'s `name` is the id; a scoped name is refused with the advice to use a directory). `package.json` must parse and list `penguin.modules`; `state.json`, dot entries, `node_modules/` and unsafe paths are refused with 400 before anything is written, under the Skill archive's caps.
- An id whose folder already has a `package.json` answers 409 `workbench_exists` with `details.workbenchId`. With `overwrite: true` the source becomes exactly the archive's (stale source files are removed), `state.json` and `.plugin.json` are kept, and `.harness/` is removed so the load writes this host's types. The workbench is loaded at once and the 201 answer is `{ workbench }`, the load's error included.
- The tab's import dialog asks before overwriting a taken id, naming it, and keeps the reason of a refused zip on screen. The component gallery answers both routes in its mock API.
