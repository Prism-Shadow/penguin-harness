# sandbox-dsh on Windows says which shell it needs

- **Date:** 2026-09-29
- **Type:** fix
- **Scope:** `plugins`

[中文版](2026-09-29-sandbox-dsh-windows-shell.zh.md)

On Windows, the DSH backend's ACL restricted-token runner cannot start bash, and bash is the
harness's default session shell there (Git for Windows, or the bundled MinGit). Every confined
command already failed closed, but with the runner's own error, which names WSL or an MSYS
internal rather than the setting that fixes it.

- The DSH backend now refuses a bash or sh session shell on Windows before the runner is
  involved. The error names the fix: `PENGUIN_SHELL=pwsh`, or `PENGUIN_SHELL=powershell` on a
  host without PowerShell 7, then restart the harness.
- The backend's README states what runs under the runner on Windows. PowerShell 7 and Windows
  PowerShell 5.1 run confined; bash and sh do not start.
- The harness's default shell is unchanged on every platform, and so is the backend on Linux
  and macOS.
- A new test covers the refusal on every platform. On a Windows host it also runs both
  PowerShells confined through the real runner.
