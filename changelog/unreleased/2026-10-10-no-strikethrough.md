# Tildes in a reply show as typed; strikethrough is not rendered

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `ui`, `web`, `server`

[中文版](2026-10-10-no-strikethrough.zh.md)

Replies use `~` for ranges (`3~5 天`) and for "about" (`~30 秒`) far more often than for strikethrough, and two of them in one paragraph struck out every word between them. Strikethrough is no longer rendered: a `~text~` or `~~text~~` shows its tildes as written, and whatever sits between them keeps its own formatting. This holds in the Web App, wherever a reply is rendered as Markdown (chat, Trace, plugin pages, file previews), and in replies relayed to Feishu, Telegram, QQ and WeChat. The rest of GFM, such as tables, task lists, autolinks and footnotes, is unchanged. The docs site and the blog, which render authored pages, are unchanged.
