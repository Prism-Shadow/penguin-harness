# 启用消息连接即是绑定

- **Date:** 2026-08-26
- **Type:** feature
- **Scope:** `server`, `web`, `docs`

[English](2026-08-26-messaging-bind-by-enable.md)

一个飞书应用或 Telegram 机器人此前会永久归属于某一个 Session：谁先保存凭据谁就拥有它，第二个
Session 保存时被 409 `feishu_app_in_use` / `telegram_bot_in_use` 拒绝，而 Web 界面又没有解绑入
口，因此把机器人换到另一个对话在产品内根本没有路径。现在保存不再互斥：启用连接才是把账号绑定
到该对话，关掉这个开关即解除绑定。

## 细节

- 保存凭据不再跨 Session 冲突。任意多个 Session 都可以同时保存同一个飞书应用或 Telegram 机器
  人，各自持有自己的配置与自己记住的会话。两个 PUT 都去掉了对应的 409，
  `MessagingBindingsRepo.upsert` 也不再有失败分支。
- 只有当**另一个 Session 已启用同一 `(channel, account_id)` 的绑定**时，启用才被拒绝：409
  `account_enabled_elsewhere`——先把那一个停用。一个账号只有一条事件流，这也是仅存的互斥。
- 该拒绝不透露持有连接的 Session 的任何信息。授权按 Project 计，而该路由只验证了调用方自己那个
  Session 的访问权，持有方可能位于调用方看不到的 Project；而且解决办法并不依赖于知道它是谁。
- 每个 Session 内部的规则不变：同一时刻至多启用自己的一个渠道（409
  `another_channel_enabled`）。
- 绑定编辑器中，连接开关以自身的 tooltip 承载新语义，「绑定后会发生什么」折叠区说明一个机器人
  如何在对话之间迁移而无需删除凭证。两个退役错误码从两份字典中移除，`account_enabled_elsewhere`
  加入其中。
- 唯一索引 `idx_messaging_account` 被同列的普通索引 `idx_messaging_by_account` 取代，已带有它的
  数据库会在打开时将其删除——参见[向后兼容](2026-08-26-backward-compatibility.zh.md)。
