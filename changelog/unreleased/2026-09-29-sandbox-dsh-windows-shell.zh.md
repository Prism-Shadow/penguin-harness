# Windows 上的 sandbox-dsh 会说明它需要哪种 shell

- **Date:** 2026-09-29
- **Type:** fix
- **Scope:** `plugins`

[English](2026-09-29-sandbox-dsh-windows-shell.md)

在 Windows 上，DSH 后端的 ACL restricted-token runner 起不了 bash，而 bash 正是 Harness 在 Windows 上的默认会话 shell（Git for Windows，或随包的 MinGit）。此前每一条受约束的命令本就按 fail-closed 失败，但报的是 runner 自己的错误——提到的是 WSL 或 MSYS 内部细节，而不是能解决问题的那项设置。

- DSH 后端现在在 Windows 上遇到 bash 或 sh 会话 shell 时，在交给 runner 之前就拒绝，错误里写明解决办法：设 `PENGUIN_SHELL=pwsh`；主机没有 PowerShell 7 时设 `PENGUIN_SHELL=powershell`；然后重启 Harness。
- 该后端的 README 写明了 Windows 上哪些 shell 能在 runner 下运行：PowerShell 7 与 Windows PowerShell 5.1 能在约束下运行；bash 与 sh 起不来。
- Harness 在各平台上的默认 shell 不变；该后端在 Linux 与 macOS 上的行为也不变。
- 新增一条测试，在所有平台上覆盖这次拒绝；在 Windows 主机上还会经真实 runner 在约束下跑两种 PowerShell。
