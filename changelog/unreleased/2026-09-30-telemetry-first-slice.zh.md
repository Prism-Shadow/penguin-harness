# 遥测第一片：总开关、内存缓冲、三处采集点、管理员读口与 `penguin telemetry`

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `server`, `cli`, `core`
- **PR:** [Myriad-Dreamin/penguin-harness#118](https://github.com/Myriad-Dreamin/penguin-harness/pull/118)

[English](2026-09-30-telemetry-first-slice.md)

服务端现在能说出时间花在哪里（PRFC-0008）。被测的模块只调用一处——Telemetry 节点上的 `span`（同步的工作用 `time`）——自己不持有时钟或作用域。新的系统设置 `telemetry`（默认关；`PUT /api/admin/settings`）打开三处固定采集点，它们只记形状——用时、大小、计数、状态，从不记内容——存进进程内的有界缓冲（5 万条或 16 MB，超限淘汰最旧的）。不写盘、不外发；重启或热推之后缓冲从空开始。开关关着时每个采集点只是一次布尔判断，缓冲不存在。

- `http.request`：平台答复的每个请求，HTTP 与 API socket 两张面都记——方法、路由模式（不记实际路径和 query）、状态码、到响应的用时、请求字节数，以及响应自己声明的字节数。每个请求有一个 id，它引出的样本带同一个 id。
- 每一代 App 的启动：迁移、插件加载、模块树里的每个节点（为此 `bootModules` 多一个可选的 `onCreated` 回调）、整段 create，以及 trace 认领与 machine 两件扫尾都落定时的 `boot.quiet`。每条样本带代号。
- 打开会话：窗口式历史读取记 `session.messages`（窗口种类、消息数），其中每读一个 Trace 文件记 `trace.read`（记录数），带同一个会话的键。

`GET /api/telemetry?view=probes|sessions|samples`（仅管理员，其他人 403）按采集点（次数、p50、p95、最大值、字节）或按会话汇总缓冲，或列出样本；`DELETE /api/telemetry` 清空。`penguin telemetry` 打印同样的视图，并有 `on`、`off`、`clear`；在会话里运行时只显示这个会话的样本，`--all` 取消。
