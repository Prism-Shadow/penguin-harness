# 从 SDK 移除未使用的分片聚合器

- **Date:** 2026-10-02
- **Type:** refactor
- **Scope:** `core`, `docs`
- **PR:** [#949](https://github.com/Prism-Shadow/penguin-harness/pull/949)
- **Breaking:** yes — `@prismshadow/penguin-core` 不再导出 `PartialAggregator`、`aggregateAll` 与 `Writer.aggregateAndWrite`

[English](2026-10-02-drop-partial-aggregator.md)

删除了 `packages/core/src/omnimessage/aggregate.ts`（`PartialAggregator`、`aggregateAll`）以及 Trace 写入器的 `aggregateAndWrite`。harness 中没有任何地方调用它们：每个生产者在 `partial_*` 分片之后都会紧跟完整消息，LLM 接口则直接取 MMSP `.done` 项作为这条完整消息。流式纪律本身——`start → delta → stop → 完整消息`——保持不变。omni-message 与架构文档不再提及该聚合器。

## 兼容性

引入了 `PartialAggregator` 或 `aggregateAll`、或调用了 `Writer.aggregateAndWrite` 的代码将无法编译。请直接使用每个分片 `stop` 之后紧跟的完整 `model_msg`，不要再自己拼接分片；写入时用 `Writer.write`，它本就会跳过 `partial_*`。
