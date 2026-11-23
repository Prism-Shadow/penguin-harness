# Use the shared reply Markdown parser in Node or the browser

- **Date:** 2026-11-23
- **Type:** refactor
- **Scope:** `ui`, `server`

[中文版](2026-11-23-shared-chat-markdown.zh.md)

The UI package exports `remarkChatMarkdown` from `@prismshadow/penguin-ui/chat-markdown`. This remark plugin parses the same GFM, bare links and emphasis in the conversation and in messages sent to chat channels. The server bundles the parser independently of the React renderer.
