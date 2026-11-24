# 终端保留最先输入的字符

- **Date:** 2026-11-24
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1828](https://github.com/Prism-Shadow/penguin-harness/pull/1828)

[English](2026-11-24-terminal-initial-input.md)

修复了终端刚获得键盘焦点时输入命令可能丢失开头几个字符的问题。无论首次打开还是重新打开终端，这时输入的字符都会按顺序送到对应的 shell。
