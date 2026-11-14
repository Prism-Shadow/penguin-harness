# 启用消息机器人前可以向所有服务器核对

- **Date:** 2026-10-19
- **Type:** feature
- **Scope:** `server`, `docs`
- **PR:** [#1218](https://github.com/Prism-Shadow/penguin-harness/pull/1218)

[English](2026-10-19-messaging-account-holders.md)

服务器原本就拒绝在自己的两个 Session 上启用同一个机器人账号。新增的两个路由把这项检查扩展到本服务器及其连接的机器：客户端在启用机器人之前即可看到它在哪里启用，让同一个机器人同一时刻只在一个服务器上运行。

## 细节

- `GET /api/messaging/accounts`（仅限管理员）列出本服务器跨所有 Project 已启用的全部机器人账号，形如 `{channel, accountId}`。它不指明任何 Session，也不含密钥；Session 已不存在的绑定不计入。
- `GET /api/projects/:projectId/messaging/account-holders?channel=&accountId=` 回答哪些服务器启用了该账号：本服务器（`machineId: null`），以及 Project 使用的机器中回答已启用的那些。无法询问的机器列在 `unreachable` 里并附原因：`not_connected`、`older_build`（机器返回 404，其版本早于该路由）或 `failed`。任何 Project 成员都可以询问；只有管理员询问时才会去问各台机器。
- Server API 文档在「跨服务器的机器人账号」一节说明这两个路由，并写明机器上的 Session 把绑定存在那台机器上、从那台机器建立连接。
- 新增的服务端测试以一个机器应用和连接它的服务器覆盖这两个路由，并验证连接方无法访问机器时，机器上的 Session 仍会回复它的机器人。
