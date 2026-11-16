# WSL sandbox: the file tools work from the desktop app, host scripts are refused by name, and a failed goal start is a 409

- **Date:** 2026-11-16
- **Type:** fix
- **Scope:** `plugins`, `server`, `docs`
- **Issue:** [#1524](https://github.com/Prism-Shadow/penguin-harness/issues/1524)

[中文版](2026-11-16-wsl-host-runtime-goal-start.zh.md)

On Windows with only the WSL sandbox backend, the desktop app's confined Sessions could not use `read_file`, `edit_file` or `write_file`, and starting Goal mode answered `Internal server error`. Both failed with `bwrap: execvp PenguinHarness`.

## Details

- The WSL backend now runs the harness's own runtime as the distro's `node` whatever the executable is called. The file tools' helper therefore runs inside the distro from the desktop app too, not only from a server started with `node.exe`.
- The backend now refuses the harness's runtime running a script file (a hook script, or an MCP Server started that way). The script's path and the host paths it is handed do not exist inside the distro. The error names the script and says such a Session needs full access. The hook still fails and never runs unconfined.
- `POST /tasks` with `goal` now answers 409 `goal_start_failed` when the goal plugin's start hook fails, whether its script errors, times out or is refused by the sandbox. The response carries the reason, no Task is started and the Session stays usable. Before, it was a 500.
- The settings and server API docs and the backend's README say that hook scripts do not run under the WSL backend. Before, the settings page said they ran once the distro was initialized again.
