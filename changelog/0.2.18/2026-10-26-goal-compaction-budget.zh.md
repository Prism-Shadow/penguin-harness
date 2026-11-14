# 目标模式预算计入轮中压缩之前的用量

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `plugins`
- **PR:** [#1355](https://github.com/Prism-Shadow/penguin-harness/pull/1355)

[English](2026-10-26-goal-compaction-budget.md)

目标模式检查 token 预算时，现在会计入本轮上下文压缩之前的用量。统计沿该 Session 之前的 Trace 文件回溯到本轮输入，不会重复计入已完成轮次的消耗。已安装 `goal` 插件的 Agent 更新插件后即可获得此修复。
