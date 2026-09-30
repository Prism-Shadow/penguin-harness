# 套接字拨号失败的机器，只要有标签页盯着就会被再拨

- **Date:** 2026-09-30
- **Type:** fix
- **Scope:** `server`
- **PR:** [Myriad-Dreamin/penguin-harness#129](https://github.com/Myriad-Dreamin/penguin-harness/pull/129)

[English](2026-09-30-machine-events-redial-a-failed-dial.md)

标签页的聚合事件流（`GET /api/projects/:projectId/machines/events`）盯着的机器，套接字拨号失败之后，事件 hub 现在会继续拨号。此前一次拨号失败就会丢掉 hub 对这台机器的订阅；而标签页的流靠 hub 自己的心跳保持打开，于是在页面重新加载之前没有任何东西再拨这台机器——它的事件断了，Machines 页上的 `socket: failed` 也一直停着。

- 拨号失败、或机器始终没有打开流时，按浏览器同样的退避重试：1 秒起、逐次翻倍、最长 30 秒。每次重试前重新读取该机器的连接，ssh 会话被替换时跟着走新的。
- 拨号成功后，流从机器给出的最后一个 event id 续上（与静默之后的重订相同），`socket` 读作 `connected`。
- 同一个套接字失败反复出现时，每一轮只写一次日志、只记一行错误表，而不是每次拨号都记。
- `/server/<machineId>/api/events` 的读取方照旧立刻收到失败；没有标签页再盯着这台机器时，hub 停止拨号。
