# 落地页、文档站与画廊的导航栏保持一致

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `ui`, `landing`, `docs`, `ui-gallery`
- **PR:** [#1331](https://github.com/Prism-Shadow/penguin-harness/pull/1331)

[English](2026-10-26-site-nav-unify.md)

三个公开站点的顶部导航改由 `@prismshadow/penguin-ui/site` 中的同一份页面清单生成，文档站与画廊因此也在「下载」和「文档」之间列出 AMSP，与落地页一致。

## 细节

- 文档站的手机菜单先列出站点链接，其下是文档侧栏；菜单按钮改称「打开菜单」/「关闭菜单」。
- 三个站点的菜单都可按 Esc 关闭。
- 直接打开 /download/ 时，「下载」标为当前页。
- 画廊导航栏的底边在预览任何主题时都保持站点的分隔线颜色。
- 宽度在 768 px 到 881 px 之间时，导航栏只显示 logo、不显示「PenguinHarness」字样，链接和控件得以放下。此前英文落地页的导航栏在这一区间的窄端会超出右边缘。
