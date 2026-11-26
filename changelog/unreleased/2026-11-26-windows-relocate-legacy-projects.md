# Windows data relocation rewrites paths inside legacy top-level Projects

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `core`, `server`

[中文版](2026-11-26-windows-relocate-legacy-projects.zh.md)

Fixed first-start path relocation after moving a pre-`projects/` Windows data directory to a new folder with Windows Setup. Project configuration files, organization configs, schedules, and Workspace Memory inside top-level legacy Project folders were rewritten to the new location before the layout migration moved those Projects under `projects/`, instead of being skipped and left pointing at the old location.

## Details

- Included top-level legacy Project folders alongside folders already under `projects/` when rewriting relocated Project paths and re-keying Workspace Memory on Windows.
- Added regression tests covering Windows relocation of both `projects/` and top-level legacy Projects, followed by the `projects/` layout migration.
