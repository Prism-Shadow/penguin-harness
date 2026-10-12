# The POSIX penguin launcher finds the Windows runtime

- **Date:** 2026-10-12
- **Type:** fix
- **Scope:** `desktop`
- **Issue:** [#816](https://github.com/Prism-Shadow/penguin-harness/issues/816)

[中文版](2026-10-12-windows-posix-launcher.zh.md)

On Windows, the `penguin` command that *Install 'penguin' Command* wrote for POSIX shells always failed from Git Bash, MSYS2 and Cygwin with "could not find the PenguinHarness runtime" and exit 1: the candidate list in the generated `bin/penguin` covered the macOS and Linux layouts only. `penguin.cmd` kept working from cmd.exe and PowerShell, which is why the breakage went unnoticed.

The generated script now also tries the Windows layout before giving up: from the app directory (`<install>/resources/app`) the executable sits at `../../PenguinHarness.exe`, the same position `penguin.cmd` resolves with `%~dp0..\..\..`. The candidate reuses the existing `WIN_EXECUTABLE` constant, and `LAUNCHER_MARKER` is unchanged, so `cli-link.ts` still recognizes launchers written by older versions.
