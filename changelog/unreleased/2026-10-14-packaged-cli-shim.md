# Packaged servers use their bundled CLI in Agent commands

- **Date:** 2026-10-14
- **Type:** fix
- **Scope:** `server`, `ci`
- **Issue:** [#1119](https://github.com/Prism-Shadow/penguin-harness/issues/1119)

[中文版](2026-10-14-packaged-cli-shim.zh.md)

Fixed packaged servers mistaking the `pnpm-workspace.yaml` shipped by `pnpm deploy` for a source checkout and writing an error stub to `<data root>/bin/penguin`.

## Details

- Added detection of the installed CLI when `PENGUIN_CLI_ENTRY` is unset, restoring `penguin` commands in Agents and terminals, including `penguin browser`.
- Kept explicit CLI overrides and source checkout selection. Server startup replaces an existing error stub with the working launcher.
- Made Docker startup use the installed command's absolute path so an old shim at the front of `PATH` cannot prevent the server from starting.
