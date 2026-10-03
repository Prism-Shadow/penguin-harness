# sandbox-dsh on Windows says which shell it needs

- **Date:** 2026-09-29
- **Type:** fix
- **Scope:** `plugins`, `core`

[中文版](2026-09-29-sandbox-dsh-windows-shell.zh.md)

On Windows, the DSH backend's ACL restricted-token runner cannot start bash, and bash is the
harness's default session shell there (Git for Windows, or the bundled MinGit). Every confined
command already failed closed, but with the runner's own error, which names WSL or an MSYS
internal rather than the setting that fixes it.

- With a bash or sh session shell on Windows, the DSH backend now fails to load, with a reason
  naming the fix: `PENGUIN_SHELL=pwsh`, or `PENGUIN_SHELL=powershell` on a host without
  PowerShell 7, then restart the harness. The backend is reported unavailable with that reason,
  and the confining tier shows as unavailable instead of refusing every command. `sessionShell`
  is now exported from `@prismshadow/penguin-core/plugin` for this check; on a runtime whose
  core lacks it, the backend loads as before.
- A confined command whose program is bash or sh is still refused on Windows before the runner
  is involved. When the program is the session shell, the error names the same fix; when it is
  not (a stdio MCP Server launched through bash), the error says the runner cannot start bash
  or sh and does not mention `PENGUIN_SHELL`.
- The failure is the MSYS runtime's, not bash's, so both checks cover every program on it: the
  other POSIX shells Git for Windows and MSYS2 ship (zsh, dash, `git-bash.exe`, …) and any
  program in their `usr\bin`.
- The backend's README states what runs under the runner on Windows. PowerShell 7 and Windows
  PowerShell 5.1 run confined; bash and sh do not start.
- The harness's default shell is unchanged on every platform, and so is the backend on Linux
  and macOS.
- A new test covers the load check and both refusals on every platform. On a Windows host it
  also checks that the default shell fails the load, and runs both PowerShells confined through
  the real runner.
