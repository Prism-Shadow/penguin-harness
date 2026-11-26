# 浏览器面板自动创建第一个标签页

- **Date:** 2026-11-26
- **Type:** fix
- **PR:** [PR](https://github.com/Prism-Shadow/penguin-harness/pull/1905)
- **Scope:** `web`, `browser`

[English](2026-11-26-browser-auto-first-tab.md)

- 打开浏览器面板且没有标签页时，会像终端面板创建第一个 shell 一样自动新建一个标签页。每次面板显示时只创建一次；已有标签页或内置浏览器不可用时不创建；关掉最后一个标签页后保留「新标签页」按钮，不会再自动创建。
- 标签栏中新标签页的地球图标改用 `done` 语义色调，不再使用过淡的弱前景色，四套主题与深色模式下都清晰可辨。
