# Trace 索引：未来 mtime 不再卡死 gate；trace_sessions 按 Agent 隔离

- **Date:** 2026-10-13
- **Type:** fix
- **Scope:** `trace-index`, `server`
- **Issue:** [#301](https://github.com/Prism-Shadow/penguin-harness/issues/301)

[English](2026-10-13-trace-index-future-mtime-and-scoped-sessions.md)

#301 报告的 Trace 索引缺陷中，本变更修复两个：日期目录的 mtime 落在未来时，不再导致每个请求都全量重扫索引；`trace_sessions` 事实缓存也不再被跨 Agent 边界改写或删除。报告中的瞬时文件系统错误处理（第 2 项）保持不变。

## 细节

- `cacheable`（所有派生缓存共享的 mtime-gate 契约）此前把未来 mtime 当作「过新」：负年龄永远到不了新鲜窗口之外，目录因此被缓存为永不匹配的哨兵值，gate 每次请求都失效，且每一轮都会重新缓存哨兵——这种卡死既无法靠安静期也无法靠重启自愈。未来 mtime 现在按真实值缓存：它不是「不稳定」，只是「错误」；任何真实变更都会把 mtime 移离缓存值，gate 照样能察觉。
- `trace_sessions` 的主键从单独的 `session_id` 改为 `(project_id, agent_id, session_id)`。同一 Project 下两个 Agent 的相同会话 id 是两段对话：一个 Agent 的 Trace 导入不再改写另一个的事实行，一个 Agent 的会话删除也不再删掉另一方的索引行而把文件留在磁盘上。`getSession` / `deleteBySession` 带上所属 Agent 的作用域——所有调用点本来就有这个信息。
- 迁移 17（`trace-sessions-agent-scoped-key`）按加宽后的键重建该表。行本就是可从磁盘重建的派生缓存，且旧形状里每个会话 id 至多一行，因此重建不丢任何行；被取代的 `idx_trace_sessions_agent` 索引随之删除（键前缀已覆盖它）。

## 兼容性

- 迁移 17 改变了表形状，因此是 restart-only：推送平台启动时会以 `RestartRequiredError` 拒绝，直到运行时自身打开过一次数据库。回滚越过它时，每个会话 id 只保留第一行——加宽键所容纳的跨 Agent 兄弟行会丢失。
