# POSIX 版 penguin 启动器在 Windows 上也能找到运行时

- **Date:** 2026-10-12
- **Type:** fix
- **Scope:** `desktop`
- **Issue:** [#816](https://github.com/Prism-Shadow/penguin-harness/issues/816)

[English](2026-10-12-windows-posix-launcher.md)

在 Windows 上，「Install 'penguin' Command」为 POSIX shell 写出的 `penguin` 命令在 Git Bash、MSYS2 和 Cygwin 中一律以 "could not find the PenguinHarness runtime" 失败并退出 1：生成的 `bin/penguin` 里候选列表只覆盖 macOS 与 Linux 两种布局。`penguin.cmd` 在 cmd.exe 和 PowerShell 中照常工作，故障因此长期未被发现。

生成的脚本现在会在放弃前再尝试 Windows 布局：从应用目录（`<install>/resources/app`）向上两级，可执行文件位于 `../../PenguinHarness.exe`，与 `penguin.cmd` 用 `%~dp0..\..\..` 解析出的位置一致。该候选复用既有的 `WIN_EXECUTABLE` 常量；`LAUNCHER_MARKER` 未变，`cli-link.ts` 仍能识别旧版本写出的启动器。
