# Telegram 绑定的链接指向其文案承诺的地方

- **Date:** 2026-08-27
- **Type:** fix
- **Scope:** `web`
- **PR:** [#506](https://github.com/Prism-Shadow/penguin-harness/pull/506)

[English](2026-08-27-telegram-botfather-link.md)

Bot Token 字段角上的链接文案是「前往开发者后台」，指向的却是 Bot API 参考文档
`core.telegram.org/bots/api`。Telegram 根本没有开发者后台，那个页面也不签发 Token——于是用户
站在唯一需要 Token 的字段上，点开唯一承诺提供它的链接，落进了一份 860KB 的 API 手册。该链接
改为打开 `@BotFather`，也就是 Token 真正的来源，文案也改为照实说明。

## 细节

- Telegram 角上链接改指向 `https://t.me/BotFather`。Telegram 自己给这个页面的标题就是
  「Launch @BotFather」，并说明它用于「创建新的机器人账号并管理已有机器人」。
- 改成文案跟随目标，而不是反过来：该渠道改用自己的 `openBotFather` 文案，而共享的「前往开发者
  后台」留给确实有后台的渠道。
- 链接表的键由 `console` 改名为 `credentialSource`，周边注释也不再把这一槽位称作后台——下一个
  被加进这张表的渠道，读到的键名与说明适用于「凭据由聊天而非网页签发」的情形。
- 创建步骤折叠区的配套链接由 `https://core.telegram.org/bots/tutorial` 改为
  `https://core.telegram.org/bots/features#botfather`。前者是「From BotFather to 'Hello
  World'」，在讲完取 Token 之后就转去下载 IDE、挑选框架——那是在写一个机器人，而这里没有人在写
  机器人。后者正是 BotFather 指南本身，开篇即 `/newbot` 与它返回的 Token，与折叠区里已有的步骤
  一致。
- 测试补齐了两处锁定：角上链接的目标，以及它的文案与目标指的是同一件事——两者在同一条断言里
  一起校验；并改为遍历两套词典，使该文案无法在测试未激活的那种语言里悄悄回退。
- 设计规格已同步改写（[penguin-harness-design #70](https://github.com/Prism-Shadow/penguin-harness-design/pull/70)）。
