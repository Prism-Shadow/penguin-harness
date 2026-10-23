# 服务端按 id 路由机器上的 Session

- **Date:** 2026-10-22
- **Type:** feature
- **Scope:** `server`, `docs`
- **PR:** [#1284](https://github.com/Prism-Shadow/penguin-harness/pull/1284)

[English](2026-10-22-session-routing-by-id.md)

已连接机器上的 Session 现在可以经本服务端的 `/api/sessions/:sessionId/…` 访问，不必带 `/server/<machineId>` 前缀：服务端找到持有该 Session 的机器，把请求转发过去。与前缀一样只对管理员开放；前缀照常可用、行为不变。Web App 目前仍使用前缀。

## 细节

- 服务端在内存中维护 Session id 到机器的索引。索引条目来自各机器的 `session_created` 与 `session_deleted` 事件；遇到没见过的 id，服务端同时询问调用方各 Project 的每台已连接机器，先答复的机器即持有该 Session。所有机器都否认的 id 记为未知 10 秒。服务端重启或热推送后索引从空开始。
- 本服务端自己索引里的 Session 一律在本地应答，即使某台机器也有同一个 id。非管理员调用方照常得到 `404` `session_not_found`。
- 转发沿用 `/server/<machineId>` 代理的身份与请求头规则，流也同样走机器的 socket，经 HTTP 与经 API socket 都是如此。
- 新增应答：持有该 Session 的机器未连接时答 `503` `not_connected`，`details` 给出机器的 `machineId` 与 `alias`；那台机器拒绝本服务端的会话时答 `502` `machine_refused`。机器的拒绝从不以 `401` 转交。
- 服务端 API 文档补充了这一路由。
