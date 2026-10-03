# 「评估任务」子夹只收 Agent 启动的被测会话

- **Date:** 2026-10-04
- **Type:** fix
- **Scope:** `web`, `docs`

[English](2026-10-04-evaluation-tasks-list.md)

在评估中心点击**使用**、从**评估**或**优化**标签页打开的对话改为普通对话，归入执行这项工作的 Agent 的对话列表，不再归入会话列表的**评估任务**折叠夹。这个折叠夹只收 Agent 经 `penguin run --source benchmark` 启动的被测会话。

## 细节

- **使用**对话框不再给预填的对话打标记，新建对话草稿创建 Session 时也不再以 `source` 发送这个标记。早先版本保存的、带有这个标记的草稿，同样创建为普通 Session。
- 本次改动之前创建的这类对话，Trace 里仍记着 `source: "benchmark"`，继续留在**评估任务**折叠夹。
- 服务端与 CLI 未改动：`POST …/sessions` 仍接受 `source: "benchmark"`，`penguin run --source benchmark` 为每个被测会话发送它。
- 评估中心、对话与服务端 API 文档随之更新。
