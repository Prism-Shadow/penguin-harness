# 用测试钉住：子智能体的完成回报不会中断其它子智能体

- **Date:** 2026-09-12
- **Type:** process
- **Scope:** `core`
- **PR:** [#708](https://github.com/Prism-Shadow/penguin-harness/pull/708)
- **Issue:** [#581](https://github.com/Prism-Shadow/penguin-harness/issues/581)

[English](2026-09-12-sibling-subagents-survive-notice.md)

针对「一个后台子智能体的完成回报导致其它仍在运行的子智能体被中断」的报告，core 测试套件新增一个用例：同一 Session 上三个 `run_in_background` 子智能体，一个在 Session 空闲时结束、另一个在 Task 运行中结束。两条投递路径上，回报都只作为输入送达模型，仅空闲路径会通知宿主，其余子智能体继续运行，直到各自以 `completed` 结束。

## 细节

- 用例驱动真实的 `Environment`、`Session` 与子智能体工具，子智能体由脚本化的 runner 在放行时作答，因此每次结束的时机都精确可控。
- 没有改动运行时代码：对照报告逐一读过所有能结束后台子智能体运行的路径，没有一条会被同级的完成回报触达。
