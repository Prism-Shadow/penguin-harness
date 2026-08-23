# 目标模式在单个 Task 撞上 max_turns 后继续

- **Date:** 2026-08-23
- **Type:** fix
- **Scope:** `core`, `docs`
- **Issue:** [#171](https://github.com/Prism-Shadow/penguin-harness/issues/171)

[English](2026-08-23-goal-mode-max-turns-round-boundary.md)

目标不再因为单个 Task 到达单 Task 轮次上限（`max_turns`）就以 `aborted` 结束。循环现在把这次掐断当作轮次边界，用全新的轮次预算开启下一轮，并把被掐断那轮未提交的工具输出（作为引擎补发保留）重放出去，工作区与进度因此得以延续。

## 细节

- 引擎的 `max_turns` 掐断会以一条 `[reached max turns (…); stopping]` 的最终 assistant 提示收尾，`stop_reason` 为 `failed`。循环现在能识别这条哨兵文本并重新开轮，而不再把任何 `failed` 最终文本都当作终态；其他 `failed` 最终文本（例如输出长度截断）仍会以 `aborted` 结束目标。
- 每一轮都撞上 `max_turns`、却始终不写目标文件的目标，仍会在轮次上限（`maxRounds`，默认 100）处停下，它依旧是失控兜底。
