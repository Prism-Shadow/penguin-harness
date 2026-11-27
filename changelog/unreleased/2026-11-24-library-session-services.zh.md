# 会话域的服务下沉为 session library 包

- **日期：** 2026-11-24
- **类型：** refactor
- **范围：** `server`、`library/session`、`library/trace`、`library/agent`、`library/messaging`

[English](2026-11-24-library-session-services.md)

服务器的会话索引服务、会话删除与归档页服务搬到先行的会话词汇包旁边。`@prismshadow/penguin-library-session` 收入会话索引服务（DB 列表、创建路径与启动采纳扫描）、会话删除遍历与归档页服务及其 DTO，以及它们在运行时讲的那批词汇：Session 列表规则、session_id 时间戳、Trace shard 路径构造、系统 Agent 在会话创建路径上的拒绝、沙箱上限比较与 workspace 分组助手。`SessionInfo` 视图与聊天频道名随契约一起搬。

服务器导入这些包；library 不引用服务器。搬动的服务在绑定服务器自有机制处保留服务器侧装配：会话运行时、Project 配置存储、trace 索引与存储、通知器以结构化 port（`SessionRuntimes`、`SessionDefaultModel`，以及 trace 接口）满足包内声明的形状，服务照旧以构造依赖收下它们。API 的导出面经再导出保持完整——`@prismshadow/penguin-server/api` 与仍在用的仓内转发让旧导入路径继续解析。

## 细节

- `library/session` 增长：`session-service`、`session-deletion`、`archived-sessions-service`（归档页的查询与响应形状随行），以及 ports 模块（`SessionRuntimes`、`SessionDefaultModel`、服务发布的会话生命周期事件、归档页收窄的 Project 视图）。包索引现在导出 `SessionInfo` 与 `MessagingChannel`。
- 服务在运行时讲的会话词汇搬进包内：列表规则与来源视图（`listing`，`library/trace/listing` 再导出）、`session_id` 时间戳（`session-id`，`library/trace/session-id` 再导出）、Trace shard 路径构造（`trace-file-path`，`library/trace/trace-index` 再导出）、系统 Agent 在会话创建路径上的拒绝（`system-agent`，`library/agent/system-agent` 再导出）、沙箱上限（`sandbox-ceiling`）与 workspace 分组（`workspace-group`）。
- `library/trace` 的 `SessionCategory` 与分类计数留在原地；session 包以类型读取。
- `library/messaging` 从会话契约再导出聊天频道名（定义随 `SessionInfo` 搬走）；一切导入路径不变。

## 兼容性

本批不改变任何行为：搬动的代码是同一份代码换了个地址。既有子路径——`@prismshadow/penguin-server/api` 与仓内转发（`services/session-service.ts`、`services/session-deletion.ts`、`services/archived-sessions-service.ts`、`services/workspace-group.ts`、`services/sandbox-ceiling.ts`、`services/system-agent.ts`）——仍导出搬动的名字（从 library 再导出）；下次改到这些文件时请改为从 library 包导入。
