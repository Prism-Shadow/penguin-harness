# Benchmark 保留参考链接

- **Date:** 2026-11-03
- **Type:** fix
- **Scope:** `core`
- **PR:** [#1433](https://github.com/Prism-Shadow/penguin-harness/pull/1433)

[English](2026-11-03-benchmark-manifest-references.md)

`benchmark_config.toml` 现在按 RFC-0001 读写 `references`，即说明题目出处（论文、上游仓库）的链接列表。此前这个键会被丢掉：保存一个带它的 Benchmark（例如发布一份导入的 Benchmark）时，链接会从文件里消失。每条链接必须是 http(s) 地址，否则按 `benchmark_manifest_invalid` 拒绝。
