# Telegram 连接能从轮询冲突中恢复，并说清失败原因

- **Date:** 2026-08-27
- **Type:** fix
- **Scope:** `server`, `web`
- **PR:** [#484](https://github.com/Prism-Shadow/penguin-harness/pull/484)

[English](2026-08-27-telegram-conflict-recovery.md)

撞上 Telegram「一个 Token 只允许一个轮询者」规则的 Telegram 绑定会停在「连接错误」，此后再也收不到消息。轮询循环现在把 `getUpdates` 失败当作真正的中断处理，会指名挡住轮询的那个 webhook，面板也完整显示失败信息，而不再只剩开头几个字。

## 细节

- 中断后的恢复以一次成功的 `getUpdates` 为准，而不是它前面的 `getMe` 探测。`getMe` 从不发生冲突，因此原先每一轮都会清零失败计数：指数退避停留在第一档，连接器无限期地每秒重试一次，每次重试都触发一次 `onError`，连接状态在 `connected` 与 `error` 之间翻转的速度快过面板的轮询。现在一次中断只上报一次，并按文档退避到 60 秒上限。
- 恢复用的轮询以 0 秒超时发出，中断结束会被立即观察到，而不必等下一个 30 秒长轮询窗口。
- 每条连接在首次轮询前执行一次 `getWebhookInfo` 探测。Bot API 中 webhook 与 `getUpdates` 互斥，因此绑定之前被指向过 webhook 的机器人此前永远无法轮询，而当时的 409 只说得出「设了一个」。探测把注册的 URL 报出来——那正是用户需要去找的东西——然后就到此为止。它不会清除该 webhook：那条注册属于用户指向的另一个服务，在这里把它删掉会让那个服务无声下线，且无从追溯。在那一侧移除后也无需重新启用：探测在每次重试时重做，连接会自行恢复。
- Bot API 中两种可操作的 409 被改写为以行动开头——「another program is already polling this bot …」与「a webhook is set on this bot, which blocks polling …」——不再沿用把要点放在句尾的 Telegram 原文。
- 连接状态行把失败信息移到开关下方独立一行，限高两行、悬停显示全文，不再与开关、标签、状态词挤在同一行里被截断。Telegram 绑定的常见问题折叠区新增一条，说明一个 Token 同一时刻只能被一个程序使用。
- 轮询冲突是同一条入站消息两次到达桥接层的原因之一；该症状的另一端见[入站去重](2026-08-27-messaging-inbound-dedupe.zh.md)。
