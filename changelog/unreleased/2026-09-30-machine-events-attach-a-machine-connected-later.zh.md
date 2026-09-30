# 标签页打开之后才连上的机器，会加入该标签页的机器事件流

- **Date:** 2026-09-30
- **Type:** fix
- **Scope:** `server`
- **PR:** [Myriad-Dreamin/penguin-harness#133](https://github.com/Myriad-Dreamin/penguin-harness/pull/133)

[English](2026-09-30-machine-events-attach-a-machine-connected-later.md)

标签页的聚合机器事件流（`GET /api/projects/:projectId/machines/events`）现在会接上开流之后本服务器才连上的机器。此前这条流只订阅开流那一刻已连接、且连接可读的机器；而标签页在显示该 Project 期间一直只持有这一条流，于是从这个标签页启用的机器、重启或热推送之后重新持有的机器、以及那一刻 ssh 会话正在重开的机器，在页面重新加载之前都不会有任何事件送到这个标签页。

- 流每打一次心跳（20 秒），就重新读取本 Project 的机器里本服务器持有连接的有哪些，把还没接上的接进来。
- 已经接上的机器不会在每次心跳时再读一遍；接上之后，失败时照旧由 hub 重拨。
- 聚合流的代码从 `machines/event-hub.ts` 移到 `machines/aggregate-stream.ts`。
