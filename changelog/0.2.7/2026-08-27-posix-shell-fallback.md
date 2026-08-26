# The agent shell no longer assumes bash exists on macOS and Linux

- **Date:** 2026-08-27
- **Type:** fix
- **Scope:** `core`
- **PR:** [#484](https://github.com/Prism-Shadow/penguin-harness/pull/484)

[中文版](2026-08-27-posix-shell-fallback.zh.md)

The shell resolver gained on POSIX the fallback chain the Windows branch already had. Without it, a machine whose `PATH` has no `bash` failed every command before it ran.

## Details

- The POSIX branch resolved to a bare `bash` unconditionally, with no existence check and no alternative. A desktop app launched from a GUI inherits the desktop session's `PATH` rather than a login shell's, and a trimmed session `PATH` — or a distribution that does not install bash — left every command failing before it ran, on every surface of the app.
- Resolution order on POSIX is now: `PENGUIN_SHELL`, then `bash` on `PATH` (still spawned as the bare name, so the child resolves it against its own `PATH`), then `/bin/bash`, `/usr/bin/bash`, `/usr/local/bin/bash` and `/opt/homebrew/bin/bash`, then `$SHELL` when it names a POSIX shell that exists, then `sh`. `$SHELL` carries the login shell of the account the server runs as, so a service account's `/usr/sbin/nologin` or `/bin/false` is skipped rather than handed `-lc`. The probe is a `PATH` directory walk rather than a subprocess: a handful of `stat` calls once per process, no shell spawned to find a shell.
- A shell resolved through the non-bash steps is reported to the model under its own name — `zsh`, `sh` — through the system prompt's `{{SHELL}}` placeholder, because that is the syntax it has to write.
