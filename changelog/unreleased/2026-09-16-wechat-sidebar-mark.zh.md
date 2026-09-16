# 会话列表重新为启用微信的对话打上标记

- **Date:** 2026-09-16
- **Type:** fix
- **Scope:** `server`
- **PR:** [#759](https://github.com/Prism-Shadow/penguin-harness/pull/759)

[English](2026-09-16-wechat-sidebar-mark.md)

启用了微信绑定的对话，每逢会话列表重新加载，侧栏里标题旁的消息渠道标记就会消失：服务端为会话行报出已启用的
渠道时只认飞书、Telegram 与 QQ，不认微信，于是这枚标记只在对话框里启用绑定之后、下一次重新加载之前可见。
这次把微信加回了这份渠道清单；它是在服务端重组为模块树时
（[#599](https://github.com/Prism-Shadow/penguin-harness/pull/599)，随 0.2.12 发布）被漏掉的。
