# 提案列表缺失时，路线图条目仍带 pill

- **Date:** 2026-09-30
- **Type:** fix
- **Scope:** `web`
- **PR:** [Myriad-Dreamin/penguin-harness#22](https://github.com/Myriad-Dreamin/penguin-harness/pull/22)

[English](2026-09-30-roadmap-row-status-unknown.md)

路线图讨论室右栏里，链接了提案的条目从组织的提案列表取状态 pill。列表没加载（读取失败、机器连接断开）或其中没有这份提案时，这一行只显示编号与标题、一个 pill 都不画，于是一次读取失败就让所有链接行的状态同时消失。现在这样的行显示一个灰色的**状态未知** pill，悬停提示列表读到后会显示状态；列表一加载，就换回提案自己的状态。
