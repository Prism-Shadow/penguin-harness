# Telegram 连接能从轮询冲突中恢复，并说清失败原因

- **Date:** 2026-08-27
- **Type:** fix
- **Scope:** `server`, `web`
- **PR:** [#484](https://github.com/Prism-Shadow/penguin-harness/pull/484)

[English](2026-08-27-telegram-conflict-recovery.md)

撞上 Telegram「一个 Token 只允许一个轮询者」规则的 Telegram 绑定会停在「连接错误」，此后再也收不到消息。轮询循环现在把 `getUpdates` 失败当作真正的中断处理，连接时清除遗留的 webhook，面板也完整显示失败信息，而不再只剩开头几个字。

## 细节

- 中断后的恢复以一次成功的 `getUpdates` 为准，而不是它前面的 `getMe` 探测。`getMe` 从不发生冲突，因此原先每一轮都会清零失败计数：指数退避停留在第一档，连接器无限期地每秒重试一次，每次重试都记一条错误，连接状态在 `connected` 与 `error` 之间翻转的速度快过面板的轮询。现在一次中断只上报一次，并按文档退避到 60 秒上限。
- 恢复用的轮询以 0 秒超时发出，中断结束会被立即观察到，而不必等下一个 30 秒长轮询窗口。
- 每条连接在首次轮询前执行一次 `deleteWebhook`。Bot API 中 webhook 与 `getUpdates` 互斥，因此绑定之前被指向过 webhook 的机器人此前永远无法轮询。待处理更新予以保留，仍由连接器自己的积压清理决定哪些算作离线期。
- Bot API 中两种可操作的 409 被改写为以行动开头——「another program is already polling this bot …」与「a webhook is set on this bot, which blocks polling …」——不再沿用把要点放在句尾的 Telegram 原文。
- 连接状态行把失败信息移到开关下方独立一行，限高两行、悬停显示全文，不再与开关、标签、状态词挤在同一行里被截断。Telegram 绑定的常见问题折叠区新增一条，说明一个 Token 同一时刻只能被一个程序使用。
