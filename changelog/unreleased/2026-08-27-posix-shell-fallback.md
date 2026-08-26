# The agent shell no longer assumes bash exists on macOS and Linux

- **Date:** 2026-08-27
- **Type:** fix
- **Scope:** `core`

[中文版](2026-08-27-posix-shell-fallback.zh.md)

`exec_command` answered `[spawn error: spawn bash ENOENT]` to every command on a POSIX machine whose `PATH` had no `bash`. The shell resolver gained the fallback chain the Windows branch already had.

## Details

- The POSIX branch resolved to a bare `bash` unconditionally, with no existence check and no alternative. A desktop app launched from a GUI inherits the desktop session's `PATH` rather than a login shell's, and a trimmed session `PATH` — or a distribution that does not install bash — left every command failing before it ran, on every surface of the app.
- Resolution order on POSIX is now: `PENGUIN_SHELL`, then `bash` on `PATH` (still spawned as the bare name, so the child resolves it against its own `PATH`), then `/bin/bash`, `/usr/bin/bash`, `/usr/local/bin/bash` and `/opt/homebrew/bin/bash`, then `$SHELL` when it points at an existing shell, then `sh`. The probe is a `PATH` walk rather than a subprocess, so a process still pays nothing for it.
- A shell resolved through the non-bash steps is reported to the model under its own name — `zsh`, `sh` — because that is the syntax it has to write.
