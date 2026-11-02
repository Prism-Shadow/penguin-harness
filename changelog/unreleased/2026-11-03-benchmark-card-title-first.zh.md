# Benchmark 卡片优先显示标题

- **Date:** 2026-11-03
- **Type:** fix
- **Scope:** `web`, `landing`
- **PR:** [#1424](https://github.com/Prism-Shadow/penguin-harness/pull/1424)

[English](2026-11-03-benchmark-card-title-first.md)

评估中心的 Benchmark 卡片（落地页的实时演示也会经过这里）不再因 id 过长而截断旁边的标题：标题先占用所需的宽度，id 只用剩下的空间，放不下时以省略号截断，悬停即可看到完整 id。
