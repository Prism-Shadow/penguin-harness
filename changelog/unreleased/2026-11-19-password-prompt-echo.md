# The password prompt turns echo off before it is shown

- **Date:** 2026-11-19
- **Type:** fix
- **Scope:** `cli`
- **PR:** [#1639](https://github.com/Prism-Shadow/penguin-harness/pull/1639)

[中文版](2026-11-19-password-prompt-echo.zh.md)

`penguin auth login` now switches the terminal to raw mode before it prints `Password for <account>:`.
Before, on macOS, a password typed the moment the prompt appeared could be echoed on the screen.
The terminal applied raw mode only after it had read the prompt.
