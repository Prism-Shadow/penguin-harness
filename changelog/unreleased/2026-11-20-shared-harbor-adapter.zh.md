# 外部任务数据共用 Harbor 适配器

- **Date:** 2026-11-20
- **Type:** feature
- **Scope:** `skills`
- **PR:** [#1662](https://github.com/Prism-Shadow/penguin-harness/pull/1662)

[English](2026-11-20-shared-harbor-adapter.md)

Agent Evaluation 支持从数据仓加载 Harbor 任务，并从独立固定的提交加载公共 Penguin 适配器。导入 Benchmark 包时会保留 `data_url` 中的外部数据仓库链接。

## 兼容性

不同数据集可复用同一份适配器检出。旧 Case 继续使用其原始任务仓内的适配器。
