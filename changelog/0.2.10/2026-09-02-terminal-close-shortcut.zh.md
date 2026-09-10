# Ctrl+W 关闭当前终端

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `web`, `docs`
- **PR:** [#590](https://github.com/Prism-Shadow/penguin-harness/pull/590)

[English](2026-09-02-terminal-close-shortcut.md)

在终端内按 Ctrl+W 即关闭该终端——与其标签上的 × 完全相同：先确认，再结束 Shell。停靠面板的终端标签与独立的 `/terminal` 页都支持；后者在浏览器允许时（由停靠面板「分离」打开的窗口）随后自行关闭窗口，直接按地址打开的窗口则留在原地显示已退出的 Shell，**新建 Shell** 一键可达。按键不会到达 Shell，也只有获得焦点的那个终端会收到它——没有注册任何全局快捷键。标签 × 的悬停提示写明了这个快捷键。

## 细节

- 浏览器把 Ctrl+W 留给关闭浏览器标签页，可能先于页面响应；桌面应用会把它交给终端。
- 在 Shell 里 Ctrl+W 原本是 readline 的删除前一个词；在 PenguinHarness 的终端内它现在是关闭。
