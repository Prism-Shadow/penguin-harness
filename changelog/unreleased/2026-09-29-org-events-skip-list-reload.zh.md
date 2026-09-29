# 组织的运行不再重载会话列表

- **Date:** 2026-09-29
- **Type:** fix
- **Scope:** `web`, `server`

[English](2026-09-29-org-events-skip-list-reload.md)

会话列表只显示用户自己的对话：每次拉取都带 `excludeOrg=1`。可组织每跑一次工位或工单，列表仍会整表重载两次：`org_run` 一次，它的 `session_created` 一次。每次重载都要把每个来源的每个 Agent 问一遍，却永远拉不回一条新行。组织一忙、机器一慢，这些重载就在浏览器里越积越多（`net::ERR_INSUFFICIENT_RESOURCES`）。现在组织的运行不再动这个列表。

## 细节

- `org_run` 照旧送到公司 store 和打开着的组织页面，但不再重载会话列表。
- 组织开出的 Session（工位会话、工单会话及其子 Session）的 `session_created` 带 `client: "org"`，其余不带。列表遇到这样的事件跳过重载，打开着的对话遇到这样的子 Session 也一样。来自尚无此字段的服务端的事件照旧重载。
