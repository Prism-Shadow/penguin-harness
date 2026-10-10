# 回复中的波浪号按原样显示，不再渲染删除线

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `ui`, `web`, `server`
- **PR:** [#1017](https://github.com/Prism-Shadow/penguin-harness/pull/1017)

[English](2026-10-10-no-strikethrough.md)

回复里的 `~` 多用来表示范围（`3~5 天`）或「大约」（`~30 秒`），很少用作删除线；同一段里出现两个时，二者之间的文字会被整段划掉。现在不再渲染删除线：`~text~` 与 `~~text~~` 的波浪号按原样显示，夹在中间的内容保留各自的格式。这在 Web App 中凡是以 Markdown 渲染回复的地方（对话、Trace、插件页、文件预览）都生效，转发到飞书、Telegram、QQ 与微信的回复也一样。GFM 的其余部分（表格、任务列表、自动链接、脚注）不变；渲染自撰页面的文档站与博客不受影响。
