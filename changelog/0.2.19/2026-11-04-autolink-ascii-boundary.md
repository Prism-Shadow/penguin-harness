# A bare URL is ASCII URL characters only, and bold closes beside it

- **Date:** 2026-11-04
- **Type:** fix
- **Scope:** `chat-markdown`, `ui`, `server`, `web`
- **PR:** [#1466](https://github.com/Prism-Shadow/penguin-harness/pull/1466)

[中文版](2026-11-04-autolink-ascii-boundary.zh.md)

In a chat reply, `**http://localhost:7367/**，要看的博文：http://localhost:7367/blog/…` rendered as one link running to the end of the line, and the bold around the first address never closed. The reply's Markdown now ends a bare URL at the first character a URL cannot hold, while parsing, so the `**` after it closes the bold and the second address is a link of its own. The Web App's transcript and the chat channels a reply is relayed to read replies with the same rule.

## Details

- A bare URL is made of the ASCII characters RFC 3986 allows (`A–Z a–z 0–9 - . _ ~ : / ? # [ ] @ ! $ & ' ( ) * + , ; = %`). CJK text, full-width punctuation, emoji, whitespace, `<`, `>`, `"`, `` ` ``, `{`, `}`, `|`, `\` and `^` end it. GFM's trailing-punctuation rule still applies at that end, so `see https://penguin.ooo, then` and `www.example.com.` link as before.
- A `]` the URL did not open ends it; balanced brackets (`?a[0]=1`) and parentheses (`x_(y)`) stay in it. A URL written as a link's text (`[https://a.com](https://b.com)`) renders as that text, so the reply has one link.
- A URL pasted with unencoded CJK in its path (`…/wiki/中文`) is cut before the CJK; the same URL percent-encoded links whole.
- Emphasis follows the CJK-friendly flanking rule ([`micromark-extension-cjk-friendly`](https://github.com/tats-u/markdown-cjk-friendly)), so `**粗体（注）**后面` and `请**打开 http://127.0.0.1:4321/**查看` render bold.
- The rule lives in one place, a new package `@prismshadow/chat-markdown` (`packages/chat-markdown`), which packages/ui's chat pipeline (bundled into its published modules) and the server's messaging parser both register in place of `remark-gfm`. The trim pass that cut a link after parsing (`remark-autolink-boundary.ts`) was removed.
- The plain-text linkifier for plugin descriptions ends an address at its last ASCII character too.
- The blog and the docs site keep GitHub-flavoured Markdown unchanged.
