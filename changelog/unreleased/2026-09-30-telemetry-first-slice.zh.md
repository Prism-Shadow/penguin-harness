# 遥测第一片：总开关、内存缓冲、三处采集点、管理员读口与 `penguin telemetry`

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `server`, `cli`, `core`

[English](2026-09-30-telemetry-first-slice.md)

服务端现在能说出时间花在哪里（PRFC-0008）。新的系统设置 `telemetry`（默认关；`PUT /api/admin/settings`）打开三处固定采集点，它们只记形状——用时、大小、计数、状态，从不记内容——存进进程内的有界缓冲（5 万条或 16 MB，超限淘汰最旧的）。不写盘、不外发；重启或热推之后缓冲从空开始。开关关着时每个采集点只是一次布尔判断，缓冲不存在。

- `http.request`：平台答复的每个请求，HTTP 与 API socket 两张面都记——方法、路由模式（不记实际路径和 query）、状态码、到响应的用时、请求与响应字节数。被采样的响应带 `x-penguin-request-id`（请求里已带的沿用），这个请求引出的样本带同一个 id。
- 每一代 App 的启动：迁移、插件加载、模块树里的每个节点（为此 `bootModules` 多一个可选的 `onCreated` 回调）、整段 create，以及 trace 认领与 machine 两件扫尾都落定时的 `boot.quiet`。每条样本带代号。
- 打开会话：窗口式历史读取记 `session.messages`（窗口种类、消息数、读的分片数与字节数），每次读分片记 `trace.read`（路径的哈希、字节数、记录数）。

`GET /api/telemetry?view=probes|sessions|samples`（仅管理员，其他人 403）按采集点（次数、p50、p95、最大值、字节）或按会话汇总缓冲，或列出样本；`DELETE /api/telemetry` 清空。`penguin telemetry` 打印同样的视图，并有 `on`、`off`、`clear`；在会话里运行时只显示这个会话的样本，`--all` 取消。

trace 事件的读取（会话级与 Agent 级的 `…/traces/:index`）与 machine 作业日志，现在在离开服务端之前把 token、key、密码形状的字段与值、PEM 私钥和 ssh 私钥路径换成 `[redacted]`。trace 文件下载保持原样。
