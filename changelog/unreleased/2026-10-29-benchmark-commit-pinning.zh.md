# 固定 Benchmark 评估的 commit

- **Date:** 2026-10-29
- **Type:** fix
- **Scope:** `skills`

[English](2026-10-29-benchmark-commit-pinning.md)

Agent Evaluation 与 Benchmark Design 要求 Case 说明写明任务仓库和完整 commit。任务链接、运行规则与检出说明使用同一 commit，评估时记录该版本。展示包继续通过原有构建和导入流程从 `main` 获取。
