# 终端保留最先输入的字符

- **Date:** 2026-11-24
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1828](https://github.com/Prism-Shadow/penguin-harness/pull/1828)

[English](2026-11-24-terminal-initial-input.md)

修复了终端刚获得键盘焦点时输入命令可能丢失开头几个字符的问题。无论首次打开还是重新打开终端，这时输入的字符都会按顺序送到对应的 shell。如果 shell 启用了 bracketed paste，重新打开时粘贴的多行文本会留在编辑区，直到按下 Enter 才提交。

重新打开终端时按下的方向键会使用前台程序的光标键模式。通过右键、中键或触屏按钮粘贴时，即使浏览器稍后才读到剪贴板，随后键入的字符也会排在粘贴内容之后。
