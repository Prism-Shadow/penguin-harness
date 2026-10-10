# 打开历史对话不再等待侧栏

- **Date:** 2026-10-03
- **Type:** fix
- **Scope:** `server`, `web`
- **PR:** [#984](https://github.com/Prism-Shadow/penguin-harness/pull/984)

[English](2026-10-03-faster-session-open.md)

打开对话不再排在侧栏的 Session 列表后面。对话页立即查证路由指向的 Session，侧栏也改为每台服务器一个请求取回全部分页，不再按 Agent 与分页逐个请求。

## 对话不再等待侧栏

- 对话页对路由指向的 Session 的直接查证，不再等待 Session 列表加载完成。该列表要为每台已连接机器上的每个 Agent 各取一次首页，此前一直挡在读者要看的对话前面。
- 列表仍在加载时查证失败，不再被当作该 Session 已不存在：路由保持待定，列表加载完成后再查证一次。列表加载完成后才返回的失败仍判定为不存在，即使该查证是在列表加载期间发出的。
- 同一个 Session 同时只有一个查证在途。此前页面在列表每次变动时都会取消并重新发起查证，一次深链会发出十来个相同的请求。路由已离开的 Session 的查证结果被丢弃。

## 侧栏的列表请求改为每台服务器一次

- 新增 `POST /api/projects/:projectId/sessions/batch`，一次请求最多携带 256 个条目，每个条目请求一个 Agent 的一页。条目接受与 `GET /api/projects/:projectId/agents/:agentId/sessions` 相同的参数并按相同规则校验，任一条目不合法，整个请求即返回 400。`reload()` 与 `loadMoreFor()` 都改用它，按工作区分组时各分组的分页请求也合为每台服务器一次。
- 结果仍按 Agent 分开：服务器上没有的 Agent 返回 `reason: "absent"`，未能作答返回 `reason: "error"`，失败不会被读成「没有对话」。
