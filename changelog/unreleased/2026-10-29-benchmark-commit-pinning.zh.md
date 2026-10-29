# 固定 Benchmark 评估的 commit

- **Date:** 2026-10-29
- **Type:** fix
- **Scope:** `core`, `skills`

[English](2026-10-29-benchmark-commit-pinning.md)

清单的 `ref` 记录任务源码 commit，导入、导出时均保留。Harbor 评估与 Benchmark 设计要求完整 commit 链接，任务、运行规则及检出说明必须使用声明的同一版本。包的导入来源继续记录在 `[origin]` 中。
