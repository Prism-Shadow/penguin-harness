# 在 Node 和浏览器中共用回复的 Markdown 解析器

- **Date:** 2026-11-23
- **Type:** refactor
- **Scope:** `ui`, `server`
- **PR:** [#1779](https://github.com/Prism-Shadow/penguin-harness/pull/1779)

[English](2026-11-23-shared-chat-markdown.md)

共享 UI 包从 `@prismshadow/penguin-ui/chat-markdown` 导出 `remarkChatMarkdown`。对话正文和转发至消息渠道的回复用同一 remark 插件解析 GFM、裸链接和强调。服务端单独打包解析器。
