# 聊天工具栏的操作避开实时统计

- **Date:** 2026-08-03
- **Type:** fix
- **Scope:** `web`
- **PR:** [#151](https://github.com/Prism-Shadow/penguin-harness/pull/151)
- **Issue:** [#150](https://github.com/Prism-Shadow/penguin-harness/issues/150)

[English](2026-08-03-chat-toolbar-layout.md)

在中等桌面宽度下，固定的侧边栏会让聊天工具栏比视口断点所暗示的窄得多。Agent 面板与 Workspace 操作现在一直保持纯图标形态，直到大屏断点为止，从而在运行指示与实时的 Token、成本、已用时间统计之间留出空间；它们的文字标签在更宽的屏幕上回归，而 title 与可访问名称让紧凑形态的按钮仍可辨识。一个浏览器回归测试复现了 issue [#150](https://github.com/Prism-Shadow/penguin-harness/issues/150) 中约 2:1 的视口比例，并验证运行状态与 Token 总量绝不相交。
