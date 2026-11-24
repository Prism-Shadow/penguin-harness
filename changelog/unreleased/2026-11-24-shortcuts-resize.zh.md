# 会话正文尺寸变化时保持快捷方式展开

- **Date:** 2026-11-24
- **Type:** fix
- **Scope:** `web`, `ui`
- **PR:** [#1832](https://github.com/Prism-Shadow/penguin-harness/pull/1832)

[English](2026-11-24-shortcuts-resize.md)

此前，输入区上方出现提示时，快捷方式会自行收起，导致第一次点击无法打开应用中心。现在，展开的快捷方式会随正文重新定位。空间不足时，弧形菜单切换为可滚动列表，键盘焦点仍停留在原先的入口。
