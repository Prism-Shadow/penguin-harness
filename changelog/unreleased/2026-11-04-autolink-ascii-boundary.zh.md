# 裸 URL 只由 ASCII 网址字符组成，紧贴其后的粗体可以闭合

- **Date:** 2026-11-04
- **Type:** fix
- **Scope:** `chat-markdown`, `ui`, `server`, `web`
- **PR:** [#1466](https://github.com/Prism-Shadow/penguin-harness/pull/1466)

[English](2026-11-04-autolink-ascii-boundary.md)

对话回复里的 `**http://localhost:7367/**，要看的博文：http://localhost:7367/blog/…` 曾被渲染成一条一直延伸到行尾的链接，第一个地址外的粗体也始终没有闭合。回复的 Markdown 现在在解析时就让裸 URL 止于第一个网址不能包含的字符，于是其后的 `**` 能闭合粗体，第二个地址也成为独立的链接。Web App 的对话记录与转发回复的各聊天渠道按同一规则读取回复。

## 细节

- 裸 URL 只由 RFC 3986 允许的 ASCII 字符组成（`A–Z a–z 0–9 - . _ ~ : / ? # [ ] @ ! $ & ' ( ) * + , ; = %`）。中文、全角标点、emoji、空白以及 `<`、`>`、`"`、`` ` ``、`{`、`}`、`|`、`\`、`^` 都会让它结束。在结束处仍按 GFM 的规则去掉末尾的标点，所以 `see https://penguin.ooo, then` 与 `www.example.com.` 的链接与以前相同。
- URL 自身没有打开的 `]` 会让它结束；成对的方括号（`?a[0]=1`）与圆括号（`x_(y)`）保留在 URL 内。写作链接文字的 URL（`[https://a.com](https://b.com)`）按文字显示，回复里只有一条链接。
- 路径里带未编码中文的 URL（`…/wiki/中文`）在中文之前截断；同一个 URL 百分号编码后整段成为链接。
- 强调按对 CJK 友好的左右侧规则判定（[`micromark-extension-cjk-friendly`](https://github.com/tats-u/markdown-cjk-friendly)），`**粗体（注）**后面` 与 `请**打开 http://127.0.0.1:4321/**查看` 都能显示为粗体。
- 规则只有一处实现：新包 `@prismshadow/chat-markdown`（`packages/chat-markdown`）。packages/ui 的对话渲染管线（打包进其发布产物）与服务端的消息渠道解析器都用它取代 `remark-gfm`。原先在解析之后截断链接的处理（`remark-autolink-boundary.ts`）已删除。
- 插件说明所用的纯文本链接识别同样让地址止于最后一个 ASCII 字符。
- 博客与文档站仍按 GitHub 风格的 Markdown 渲染，不受影响。
