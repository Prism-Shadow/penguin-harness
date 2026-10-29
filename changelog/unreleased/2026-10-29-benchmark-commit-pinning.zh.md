# 固定 Benchmark 构建与评估的 commit

- **Date:** 2026-10-29
- **Type:** fix
- **Scope:** `core`, `build`, `skills`

[English](2026-10-29-benchmark-commit-pinning.md)

Benchmark 包从指定的仓库 commit 打包，修改锁定版本后自动刷新构建缓存。包仍只包含清单和 Case Markdown。

清单的 `ref` 记录任务源码 commit，导入、导出时均保留。Harbor 评估与 Benchmark 设计要求完整 commit 链接，任务、运行规则及检出说明必须使用声明的同一版本。包的导入来源继续记录在 `[origin]` 中。
