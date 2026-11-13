# 公开站点共用导航与光标规则

- **Date:** 2026-10-16
- **Type:** fix
- **Scope:** `ui`, `landing`, `docs`, `ui-gallery`, `skills`
- **PR:** [#1142](https://github.com/Prism-Shadow/penguin-harness/pull/1142)

[English](2026-10-16-shared-site-ui.md)

Landing、文档和组件展示页现在复用 UI 包中的导航栏、语言菜单、主题切换和 GitHub 入口。语言菜单支持方向键导航，按 Esc 关闭时会将焦点返回触发按钮。

这些站点的按钮、标签页和折叠控件统一使用与应用相同的箭头光标，正文链接保留手型。前端 skill 扩展到全部前端包，要求后续改动优先复用或扩展共享组件和样式。
