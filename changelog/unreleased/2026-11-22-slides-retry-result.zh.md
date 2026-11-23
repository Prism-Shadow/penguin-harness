# AI PPT 重试时保留正确的任务结果

- **Date:** 2026-11-22
- **Type:** fix
- **Scope:** `use-bento-slides`
- **PR:** [#1707](https://github.com/Prism-Shadow/penguin-harness/pull/1707)
- **Issue:** [#1701](https://github.com/Prism-Shadow/penguin-harness/issues/1701)

[English](2026-11-22-slides-retry-result.md)

AI PPT 在同一演示文稿中重试请求时，会等新任务提交完成再读取结果。此时刷新面板，上一条请求的停止原因仍归属于原请求。
