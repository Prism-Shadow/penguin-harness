# 同一次 Harbor 评测共用一个适配器版本

- **Date:** 2026-11-27
- **Type:** fix
- **Scope:** `skills`
- **PR:** [#1925](https://github.com/Prism-Shadow/penguin-harness/pull/1925)

[English](2026-11-27-harbor-adapter-main.md)

Agent Evaluation 在实验开始时从 `main` 确定公共 Harbor 适配器的 commit，整次实验的所有试验共用这一版。Benchmark Design 更新了 Case 编写说明，任务数据固定到完整 commit，公共运行说明和适配器链接到 `main`。
