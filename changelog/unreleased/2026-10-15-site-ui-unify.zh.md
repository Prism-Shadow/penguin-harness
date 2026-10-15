# 落地页与文档站经由 UI 包共用页面组件

- **Date:** 2026-10-15
- **Type:** refactor
- **Scope:** `ui`, `landing`, `docs`, `ui-gallery`, `skills`
- **PR:** [#1161](https://github.com/Prism-Shadow/penguin-harness/pull/1161)

[English](2026-10-15-site-ui-unify.md)

落地页与文档站各自保留的那份组件副本迁入了 `@prismshadow/penguin-ui/site`，与 [#1142](https://github.com/Prism-Shadow/penguin-harness/pull/1142) 迁入的顶栏放在一起：页脚、代码卡片与复制按钮、博客的分类胶囊、外链确认、文档侧栏与搜索对话框、文章的「本页目录」栏、文章排版（`SiteMarkdown`，含文档的标签组与提示框）、基于共用 `penguin-site.*` 键的主题与语言 Provider，以及路由切换时的滚动。两个站点只保留各自的内容、路由与文案，组件画廊也改为从包里读取同一组偏好键。

## 细节

- `site.css` 以自己的调色板承载这些组件的外观与文章排版，因而通过包的去 AI 味检查，在画廊里切换任何应用主题时外观都不变。站点的 Tailwind 入口另外引入新增的 `site-page.css`：`dark` 变体、品牌色阶、中性深色灰阶与 body 默认样式。
- 围栏代码由包自己的高亮引擎（`highlightSiteCode`）着色；引擎新增 PowerShell（`powershell`、`ps`、`ps1`），并把 `jsonl` 围栏按 JSON 着色，Web App 的代码块同样受益。文档站不再直接依赖 `shiki`、`react-markdown` 与 `remark-gfm`。
- 组件画廊新增「公开站点 / Public site」页，展示全部共用的站点组件。
- 访客能看到的变化：
  - 文档站的深色模式改用落地页的中性深色（画布 #141414），不再是纯黑，页面与顶栏成为同一层表面。
  - 博客文章的代码块与文档一样高亮，字号与行高也一致（13 px 字号、24 px 行高）；「本页目录」栏不再超出视口，过长时可滚动，并保持读者点过的条目处于选中状态。
  - 复制按钮复制后保留原文字：图标换成对勾，读屏软件播报已复制，与 Web App 一致。
  - 复制、箭头、搜索、终端、链接与外链图标改用共享图标注册表，与顶栏一致。
