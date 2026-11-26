# 打开应用时「应用中心」导航项不再高亮

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1902](https://github.com/Prism-Shadow/penguin-harness/pull/1902)

[English](2026-11-26-app-center-nav-inactive-on-app.md)

从侧边栏「应用」列表打开应用时，应用行与「应用中心」导航项会同时高亮，原因是应用窗口位于 `/apps?app=…` 之下。现在「应用中心」仅在其网格显示时才是当前页；打开应用（工作台应用、机器上的应用或系统应用）时，侧边栏中只有该应用自己的行为当前页。
