# Windows 上的 sandbox-dsh 会说明它需要哪种 shell

- **Date:** 2026-09-29
- **Type:** fix
- **Scope:** `plugins`, `core`

[English](2026-09-29-sandbox-dsh-windows-shell.md)

在 Windows 上，DSH 后端的 ACL restricted-token runner 起不了 bash，而 bash 正是 Harness 在 Windows 上的默认会话 shell（Git for Windows，或随包的 MinGit）。此前每一条受约束的命令本就按 fail-closed 失败，但报的是 runner 自己的错误——提到的是 WSL 或 MSYS 内部细节，而不是能解决问题的那项设置。

- Windows 上会话 shell 是 bash 或 sh 时，DSH 后端现在加载即失败，原因写明解决办法：设 `PENGUIN_SHELL=pwsh`；主机没有 PowerShell 7 时设 `PENGUIN_SHELL=powershell`；然后重启 Harness。该后端带着这条原因被报为不可用，封禁档位显示为「不可用」，而不是可选、选中后每条命令被拒。为此 `sessionShell` 现经 `@prismshadow/penguin-core/plugin` 导出；宿主的 core 没有这个导出时（较旧的运行时），后端照常加载。
- 程序名是 bash 或 sh 的受约束命令，在 Windows 上仍在交给 runner 之前被拒：它就是会话 shell 时，错误写的是同一条改法；不是会话 shell 时（以 bash 启动的 stdio MCP Server），错误只写明 runner 起不了 bash 与 sh，不提 `PENGUIN_SHELL`。
- 起不来的根源是 MSYS 运行时，而非 bash 本身，因此两项检查覆盖该运行时上的所有程序：Git for Windows 与 MSYS2 自带的其他 POSIX shell（zsh、dash、`git-bash.exe` 等），以及它们 `usr\bin` 下的任何程序。
- 该后端的 README 写明了 Windows 上哪些 shell 能在 runner 下运行：PowerShell 7 与 Windows PowerShell 5.1 能在约束下运行；bash 与 sh 起不来。
- Harness 在各平台上的默认 shell 不变；该后端在 Linux 与 macOS 上的行为也不变。
- 新增测试在所有平台上覆盖加载检查与两种拒绝；在 Windows 主机上还检查默认 shell 下加载即失败，并经真实 runner 在约束下跑两种 PowerShell。
