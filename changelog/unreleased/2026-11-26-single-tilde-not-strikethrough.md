# Chat Markdown: a single tilde is not strikethrough

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `chat-markdown`
- **PR:** [#1884](https://github.com/Prism-Shadow/penguin-harness/pull/1884)

[中文版](2026-11-26-single-tilde-not-strikethrough.zh.md)

A lone `~` no longer pairs with the next one as GFM strikethrough, so two ranges in one paragraph
can no longer strike out everything between them — including the `**` that text holds. `耗时 3~5 天，进度 **10~20%**` renders its bold instead of leaving the asterisks, and `alpha 0.3~0.8 → **0.45~1.0**，新增**脉冲金环描边**` keeps both spans. `~~` still parses, and the rule holds wherever a reply is read in the chat dialect: the Web App and the chat channels.

## Details

- No host renders a strikethrough: each shows a reply's tildes as written (`remark-literal-tildes.ts` in the Web App, the same pass in `library/messaging`). A single tilde's only remaining effect was to make a `~…~` span swallow the Markdown inside it, which is why it is now text.
- Ranges (`3~5 天`), approximations (`~30 秒`) and `~d~` read exactly as before; `~~gone~~` is still a strikethrough node in the tree.
- One entry decides it for every host: the Web App's transcript and the chat channels both parse replies through `@prismshadow/penguin-ui/chat-markdown`.
