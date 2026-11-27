# 新对话草稿阶段打开的页面随对话交给它所在的机器

- **Date:** 2026-11-26
- **Type:** feature
- **Scope:** `browser-automation`
- **PR:** [#1917](https://github.com/Prism-Shadow/penguin-harness/pull/1917)

[English](2026-11-26-machine-draft-pages.md)

工作区在远程机器上的新对话，在发出第一条消息之前从浏览器面板打开的页面，现在会在首次发送于机器上建出这个对话后交给它：分区仍是同一个 Project 的，机器上的 Agent 随即就能操作这些页面。此前这些页面留在草稿里。

- 本服务端的 `POST /api/builtin-browser/tabs/session` 接受自己不持有的 Session，前提是草稿所属 Project 的某台机器确认这个 Session；交过去的页面随即归那台机器上的 Session。
- 机器立刻得知这些页面，不必等页面再有变化。
