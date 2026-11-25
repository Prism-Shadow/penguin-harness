# The data root's layout migration moves every Project folder or none

- **Date:** 2026-11-25
- **Type:** fix
- **Scope:** `core`, `server`
- **PR:** [#1865](https://github.com/Prism-Shadow/penguin-harness/pull/1865)

[中文版](2026-11-25-layout-migration-windows-rename.zh.md)

Made the data root's layout migration ([Projects moved under `projects/`](2026-11-20-data-root-projects.md)) move all of a run's Project folders or none. A Project folder that could not be renamed, as on Windows while a program held it open, left the data root in the layout it had, and the start or hot update that met it said what to close.

## Details

- The migration renamed every Project folder of a run into `projects/`, and left its link, before rewriting the paths any Project records. When one could not be renamed, it put back the ones renamed before it, newest first, removed the run's journal entries and an empty `projects/` folder, and stopped with nothing moved, for the next start or push to try them all again.
- A rename Windows still refused after its retries (`EPERM`, `EBUSY` or `EACCES`) stopped the run with the new `LayoutMigrationError` code `folder_in_use`. Its sentence names the folder and what usually holds it: a terminal, editor or File Explorer window, or a command running in one of its Workspaces.
- When a pushed platform met that refusal, it added to the sentence that the server keeps its current version and that restarting it ends its terminals and commands, which a hot update keeps running.
