# The session list marks WeChat-enabled conversations again

- **Date:** 2026-09-16
- **Type:** fix
- **Scope:** `server`
- **PR:** [#759](https://github.com/Prism-Shadow/penguin-harness/pull/759)

[中文版](2026-09-16-wechat-sidebar-mark.zh.md)

A conversation with an enabled WeChat binding lost the messaging mark beside its title in the
sidebar whenever the session list reloaded: the server named a row's enabled channel for Feishu,
Telegram and QQ but not for WeChat, so the mark showed only from enabling the binding in the dialog
until the next reload. WeChat was added back to that list; the rearrangement of the server into a
module tree ([#599](https://github.com/Prism-Shadow/penguin-harness/pull/599)), released in 0.2.12,
had dropped it.
