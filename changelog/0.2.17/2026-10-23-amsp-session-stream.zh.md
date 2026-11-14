# AMSP v1 改为传送 Session 自己的记录，SDK 随之改为读取记录

- **Date:** 2026-10-23
- **Type:** feature
- **Scope:** `amsp`, `server`, `core`, `web`, `docs`
- **PR:** [#1301](https://github.com/Prism-Shadow/penguin-harness/pull/1301), [#1308](https://github.com/Prism-Shadow/penguin-harness/pull/1308)
- **Breaking:** yes — `/api/amsp/v1` 路径不变，流的形状改变：`run.*`、`K.delta` 与 `K.done` 事件让位于 Session 的记录，0.2.16 及更早的 `@prismshadow/amsp` 客户端读不懂新的流。本版本的 SDK（`^0.2.16` 的依赖会取到它）也读不懂旧服务端的流。

[English](2026-10-23-amsp-session-stream.md)

Agent API 按 Trace 的样子传送一个 Session：每条记录都是 Trace 存储的外壳，不经翻译，另有 `partial_*` 片段与心跳 `ping`。SDK 读取并跟随这些记录；API 也补上了程序跟随一个不是自己发起的 Session 所需的路由。

## 流

- 记录是不带名字、带 `id:` 的 SSE 事件，数据为外壳 `{timestamp, type, payload, origin?}`。控制帧为 `event: ping`（`{}`，立即一次、此后每 20 秒，取代 `: keep-alive`），以及运行流末尾的 `data: [DONE]`。
- 运行流依次为 `ping`、本次运行从第一条主会话记录起的记录，Session 回到空闲后以 `[DONE]` 收尾。新 Session 的第一条消息，`session_meta` 排在最前、在 `task_begin` 与输入之前，其 `session_id` 即新 Session 的 id；之后的消息不再带它，延续 Session 的运行即请求所带的 `session_id`。
- Web App 的服务端事件（`task_state`、`approval_request`、`session_title`、`goal_*` 等）不出现在任何 AMSP 入口上。没有走到终点的运行，最后一个 `task_begin` 在 `[DONE]` 之前未闭合；没有错误帧。

## 路由

- 密钥门在 `runs`、Session 与中止之外，新增：
  - `GET sessions/:id/stream`：Session 流，按 `Last-Event-ID` 续传；该 id 已不在缓冲中或服务器重启过时，不开流，以 JSON 答 `409` `resync_required`；
  - `GET sessions/:id/messages` 与 `GET sessions/:id/trace-image`：Web App 的历史处理器，图片引用指向密钥门；
  - `GET sessions/:id/approvals[?wait=1–60]`：等待决定的调用，可长轮询；
  - `POST sessions/:id/tasks`：不占用连接的运行（202；忙时 409，不排队）。
- Cookie 门新增 `GET /api/sessions/:id/amsp`，即同一个 Session 流，供已登录的读者；`GET /api/sessions/:id/approvals` 即同一个待决审批资源。`/api/sessions/:id/stream` 不变。
- 从记录到 v1 事件的翻译器已删除。

## 核心

- Session 写下的每条 `session_meta` 都上流恰好一次：第一条排在第一个 Task 的 `task_begin` 之前；压缩开启的新上下文的那条在其文件开出时上流，位于下一个 Task 的 `task_begin` 之后、该 Task 的输入之前。模型切换本就上流其 meta。
- `Session.contextOpenPending()` 表示下一个 Task 会开出新文件；服务端据此把运行的输入回显排在那条 `session_meta` 之后。
- 父会话的流仍只带一次子会话的 `session_meta`。

## SDK `@prismshadow/amsp`

- SDK 与其他包一样，以本版本的版本号随本版本发布。`AgentClient.stream()` 与 `AgentClient.run()` 保持 0.2.16 的含义：`stream()` 返回可迭代的运行，`run()` 只返回结果。`RunResult` 由记录读出：`status` 与 `error`、`text`、`usage`、`sessionUsage` 与 `requests`。
- 审批循环在有 `tool_call` 等待决定时长轮询待决审批资源，把每个调用交给 `onApproval(toolCall, origin)`；没有回调时答 `deny`。
- 新增 `messages()`、`approvals()`、`SessionReader`（先读历史、再接实时尾部，去重，静默 50 秒后重连，重连被以 `resync_required` 拒绝时从头开始）、`HttpTransport` 与 `Transport` 接口、带事件名与 id 的 `readSse`、`readAmsp`，以及浏览器构建 `dist/browser/amsp.js`。

## Web App

- API 标签的「试一试」经 SDK 运行。每行以记录的 `payload.type` 为标签，同一条消息的片段与完整记录合为一行，不列出 `ping`。「允许」/「拒绝」位于等待中的 `tool_call` 行。结果栏即本次运行的 `RunResult`，或写明事件流在 `[DONE]` 之前结束、运行没有走到终点。
- 标签页的 SDK 示例改为迭代 `stream()`。

## 兼容性

- `/api/amsp/v1` 路径不变，但本版本起流的形状改变；本版本仍在 0.2 系列内（用户 2026-10-23 决定）。0.2.16 及更早的 `@prismshadow/amsp` 客户端以及解析 `run.*` / `K.delta` / `K.done` 事件的程序，须改用本版本的 SDK 或直接读记录。
- SDK 的版本号与 harness 一致，因此依赖 `^0.2.16` 的程序在下一次安装或更新时会取到这个不兼容的客户端。尚未改完的程序应固定 `@prismshadow/amsp@0.2.16`，它仍可对接 0.2.16 及更早的服务端。
- 本版本的 SDK 同样读不懂旧服务端的流：服务端与客户端须一起升级。
- 文档站 amsp 页列出每个 v1 事件对应的新记录。
- 不保留兼容层（用户 2026-10-23 决定）。
