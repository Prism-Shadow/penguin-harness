# 终端 PATH 测试在 macOS 上为 pwsh 补发丢失的回车

- **Date:** 2026-10-09
- **Type:** test
- **Scope:** `server`
- **PR:** [#1005](https://github.com/Prism-Shadow/penguin-harness/pull/1005)

[English](2026-10-09-terminal-pwsh-enter-flake.md)

`test/terminal-path-first.test.ts` 在 macOS CI 上时有失败：pwsh 在 PSReadLine 接管终端之前就打印了提示符，键入的命令行进了缓冲区，随之发出的回车却丢了，测试一直等到超时。现在若五秒后仍未出现预期输出，测试会再发一次回车。
