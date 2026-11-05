# Windows CLI launcher for Git Bash, MSYS2 and Cygwin

- **Date:** 2026-10-14
- **Type:** fix
- **Scope:** `desktop`
- **PR:** [#1123](https://github.com/Prism-Shadow/penguin-harness/pull/1123)
- **Issue:** [#816](https://github.com/Prism-Shadow/penguin-harness/issues/816)

[中文版](2026-10-14-windows-posix-launcher.zh.md)

Fixed the desktop app's `penguin` command failing to find its runtime from Git Bash, MSYS2 and Cygwin on Windows. The POSIX launcher was updated to locate `PenguinHarness.exe` and use `cygpath`, when available, to pass the bundled CLI entry in Windows path format.
