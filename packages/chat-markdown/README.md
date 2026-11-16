# @prismshadow/chat-markdown

The Markdown dialect PenguinHarness reads an Agent's reply in, as one
[remark](https://github.com/remarkjs/remark) plugin. The Web App's transcript and the chat
channels a reply is relayed to (Telegram, Feishu, QQ, WeChat) both register it, so the two
link and bold the same characters.

The dialect is CommonMark plus GFM's tables, task lists, footnotes and strikethrough, with two
changes, both made while parsing:

- A bare URL is made of the ASCII characters RFC 3986 allows. CJK text, full-width
  punctuation, emoji and whitespace end it, and GFM's trailing-punctuation rule applies at that
  end, so in `**http://localhost:7367/**，见下文` the link ends at `/` and the bold closes.
- Emphasis follows the CJK-friendly flanking rule
  ([`micromark-extension-cjk-friendly`](https://github.com/tats-u/markdown-cjk-friendly)), so
  `**粗体（注）**后面` is bold.

```ts
import { remarkChatMarkdown } from "@prismshadow/chat-markdown";
import remarkParse from "remark-parse";
import { unified } from "unified";

const tree = unified().use(remarkParse).use(remarkChatMarkdown).parse(reply);
```

It takes the place of `remark-gfm`; a host adds its own passes after it.
