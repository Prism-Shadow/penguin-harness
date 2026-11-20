# 密码提示在显示之前先关闭回显

- **Date:** 2026-11-19
- **Type:** fix
- **Scope:** `cli`
- **PR:** [#1639](https://github.com/Prism-Shadow/penguin-harness/pull/1639)

[English](2026-11-19-password-prompt-echo.md)

`penguin auth login` 现在先把终端切到原始模式，再打印「Password for <账号>:」。此前在 macOS 上，提示一出现就输入的密码可能回显在屏幕上：终端要等读完提示才切到原始模式。
