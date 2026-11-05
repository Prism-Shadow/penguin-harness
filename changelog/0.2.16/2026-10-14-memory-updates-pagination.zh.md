# 恢复长会话中的记忆更新卡片

- **Date:** 2026-10-14
- **Type:** fix
- **Scope:** `server`, `web`
- **PR:** [#1138](https://github.com/Prism-Shadow/penguin-harness/pull/1138)

[English](2026-10-14-memory-updates-pagination.md)

修复了会话加载的历史分页不含开头的会话元数据时，记忆更新卡片缺失的问题。
历史分页补充了记录中的 Agent State 目录，使打开会话、加载更早消息和重连后都能显示记忆编辑。
