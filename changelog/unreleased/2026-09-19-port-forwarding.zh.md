# 端口转发：把机器上的端口带到本服务端的回环上，按 Workspace 管理

- **Date:** 2026-09-19
- **Type:** feat
- **Scope:** `server`, `web`, `docs`

[English](2026-09-19-port-forwarding.md)

位于机器上的 Workspace 可以在终端旁的「端口」面板里，把该机器的 TCP 端口转发到本服务端的回环上。转发会被保存；每台机器的 Ports 页列出它的全部转发及各自的已知事实。

## 转发

- **一条转发是 `(机器, Workspace, 远端端口) → 本地端口`。** 它属于 Workspace（某台机器上的一个目录），因此该 Workspace 的每个对话看到同一份转发。位于本服务端的 Workspace 没有转发：它的端口本就在回环上。
- **保存在 `web.db`**（表 `port_forwards`，migration 13 `port-forwards`，swap-safe）。重启或热推送之后，转发在同一个本地端口上恢复。缺省本地端口取与远端端口同号的端口（空闲时），否则向上取第一个空闲端口；也可以指定一个（1024–65535）。
- **listener 只绑 `127.0.0.1`。** 它在创建转发时与平台每次启动时 bind。启动时 bind 不上的端口会记在该转发上；记录与端口保持不变。
- **只有客户端连上时才拨号**，且走该机器的唯一连接（`Machines.dialPort`）。转发从不拉起 ssh：机器未连接时，客户端立即被关闭，并记下原因。
- **半关闭的连接会被原样传递**，因此发送完毕的客户端仍能收到回应。

## API

- `GET /api/port-forwards?machine=&workspace=`、`POST /api/port-forwards`、`DELETE /api/port-forwards/:id`，仅管理员。
- 每条转发按层给出事实：`listener`（`{listening}` 或 `{error}`）、`dial`（最近一次拨号：`{answeredAt}` 或 `{failedAt, detail}`）、`open` 连接数、`bytesUp` 与 `bytesDown`。

## 页面

- **停靠栏新增「端口」面板。** 每行显示 `远端端口 → localhost:<本地端口>` 与一个状态圆点：listener 在听且最近一次拨号成功（或尚未拨过）为蓝，最近一次拨号失败为琥珀，listener 起不来为红。行上可以复制本地地址、在浏览器中打开、删除转发。下方表单填写远端端口与可选的本地端口。
- **机器卡片新增「端口」按钮**，打开 `/machines/<machineId>/ports`：该机器的全部转发按 Workspace 分组，给出 listener 状态、最近一次拨号及其时刻、当前连接数与上下行字节数。转发可在此删除，新增则在对话的「端口」面板里做。
