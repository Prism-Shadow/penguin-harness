# Chat Markdown: bold closes after closing punctuation

- **Date:** 2026-11-16
- **Type:** fix
- **Scope:** `chat-markdown`
- **PR:** [#1568](https://github.com/Prism-Shadow/penguin-harness/pull/1568)
- **Issue:** [#1500](https://github.com/Prism-Shadow/penguin-harness/issues/1500)

[中文版](2026-11-16-chat-bold-after-punctuation.zh.md)

A run of two or more `*` right after `. , : ; ! ? ) ] }` closes bold even when a letter or a digit follows with no space, so `**Confirmed.**Next sentence.` and `**端口:**7364` render bold instead of showing their asterisks, and such a span no longer turns back into asterisks while a reply streams in past it. The rule holds wherever a reply is read in the chat dialect: the Web App and the chat channels.

## Details

- A run after an opening bracket or a quote, a single `*` and `_` parse as before, so `f(**kwargs)` and `snake_case` keep their characters.
- Prose such as `(a+b)**2 and (c+d)**3` now pairs into bold between the two runs.
