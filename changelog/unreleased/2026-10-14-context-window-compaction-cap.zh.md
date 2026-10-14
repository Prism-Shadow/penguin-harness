# Agent 阈值超过模型窗口时，压缩按窗口生效

- **Date:** 2026-10-14
- **Type:** feature
- **Scope:** `core`, `web`
- **PR:** [#1121](https://github.com/Prism-Shadow/penguin-harness/pull/1121)

[English](2026-10-14-context-window-compaction-cap.md)

当 Agent 的 `compaction.max_context_length` 超过所选模型的 `context_window` 时，实际生效的阈值在运行时按窗口收敛。存量 Agent 配置不做任何改写，原有的"Agent 设置超过模型窗口"提示继续仅作建议。

## Details

- `resolveCompaction` 对比配置值与窗口推导出的上限，只在配置值确实被压住时才记录 `compactionOrigin: "capped_by_window"`，之后恢复的 checkpoint 经同一解析器继承该标记。
- `compaction_begin` trace 事件仅在收敛实际发生时携带 `compaction_origin`，事后可审计当时生效的阈值。
- 被压住时上下文面板头部同时显示两个数字：配置的设定值与实际生效值，琥珀色标出。
