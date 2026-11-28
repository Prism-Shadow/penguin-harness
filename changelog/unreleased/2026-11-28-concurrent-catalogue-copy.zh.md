# 并发复制随包发布的 Benchmark 包

- **Date:** 2026-11-28
- **Type:** fix
- **PR:** [#1943](https://github.com/Prism-Shadow/penguin-harness/pull/1943)
- **Scope:** `core`

[English](2026-11-28-concurrent-catalogue-copy.md)

向新 Project 写入内置 Benchmark 包时，改为并发复制文件，不再逐个串行。随包发布的目录已从数百个
文件增长到约 4000 个，串行复制每个 Project 需要一秒以上（Linux 上现约 0.4 秒）。
