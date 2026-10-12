# A channel keeps the message you have not sent

- **Date:** 2026-09-20
- **Type:** fix
- **Scope:** web
- **PR:** [#810](https://github.com/Prism-Shadow/penguin-harness/pull/810)

[中文版](2026-09-20-channel-draft.zh.md)

- Text typed into a channel's composer and not sent used to live only in the open view: opening another channel, a desk, any other page — or reloading — threw it away. It is now kept per user and per channel in the browser, the way a conversation's unsent input already was: coming back to the channel finds the text where it was left, another channel does not inherit it, and sending the message (or emptying the box) is what ends it.
