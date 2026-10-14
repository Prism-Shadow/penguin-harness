# 修复 Git Bash、MSYS2 和 Cygwin 中的 Windows CLI 启动器

- **Date:** 2026-10-14
- **Type:** fix
- **Scope:** `desktop`
- **PR:** [#1123](https://github.com/Prism-Shadow/penguin-harness/pull/1123)
- **Issue:** [#816](https://github.com/Prism-Shadow/penguin-harness/issues/816)

[English](2026-10-14-windows-posix-launcher.md)

修复了 Windows 桌面应用的 `penguin` 命令在 Git Bash、MSYS2 和 Cygwin 中找不到运行时的问题。POSIX 启动器增加了对 `PenguinHarness.exe` 的查找，并在 `cygpath` 可用时，将内置 CLI 的入口路径转换为 Windows 格式。
