# 外部数据仓中的 Benchmark 文件

- **Date:** 2026-11-20
- **Type:** fix
- **Scope:** `landing`
- **PR:** [#1663](https://github.com/Prism-Shadow/penguin-harness/pull/1663)

[English](2026-11-20-external-benchmark-file-browser.md)

官网的 Benchmark 详情页通过包里的 `data_url` 找到数据仓库，从默认分支展示题目说明和文件列表。

## 细节

多个包使用同一个数据仓时共用一次稀疏检出。GDPevo 文章中的场景链接已更新。
