# Telegram 绑定的链接指向其文案承诺的地方

- **Date:** 2026-08-27
- **Type:** fix
- **Scope:** `web`

[English](2026-08-27-telegram-botfather-link.md)

Bot Token 字段角上的链接文案是「前往开发者后台」，指向的却是 Bot API 参考文档
`core.telegram.org/bots/api`。Telegram 根本没有开发者后台，那个页面也不签发 Token——于是用户
站在唯一需要 Token 的字段上，点开唯一承诺提供它的链接，落进了一份 860KB 的 API 手册。现在这个
链接打开 `@BotFather`，也就是 Token 真正的来源，并且文案照实说明。

## 细节

- Telegram 的 `console` 改为 `https://t.me/BotFather`。Telegram 自己给这个页面的标题就是
  「Launch @BotFather」，并说明它用于「创建新的机器人账号并管理已有机器人」。
- 是文案跟随目标，而不是反过来：该渠道改用自己的 `openBotFather` 文案，而共享的「前往开发者
  后台」留给确实有后台的渠道。该文案在渲染时读取，而不是存进模块级链接表——`S` 是语言 Provider
  会整体替换的 live binding，在模块初始化时取值会把语言固定住。
- 创建步骤折叠区的配套链接由 `https://core.telegram.org/bots/tutorial` 改为
  `https://core.telegram.org/bots/features#botfather`。前者是「From BotFather to 'Hello
  World'」，在讲完取 Token 之后就转去下载 IDE、挑选框架——那是在写一个机器人，而这里没有人在写
  机器人。后者正是 BotFather 指南本身，开篇即 `/newbot` 与它返回的 Token，与折叠区里已有的步骤
  一致。
- 两处都有测试锁定：角上链接的目标，以及它的文案与目标指的是同一件事。
