# 外部数据仓中的 Benchmark 文件

- **Date:** 2026-11-20
- **Type:** fix
- **Scope:** `landing`
- **PR:** [#1663](https://github.com/Prism-Shadow/penguin-harness/pull/1663)

[English](2026-11-20-external-benchmark-file-browser.md)

官网的 Benchmark 详情页从每道题固定的数据版本读取任务说明和文件目录，文件链接指向相同提交。

## 细节

同一数据仓版本共用一次稀疏检出，只下载 README 与题目说明。GDPevo 文章中的场景链接已更新。
