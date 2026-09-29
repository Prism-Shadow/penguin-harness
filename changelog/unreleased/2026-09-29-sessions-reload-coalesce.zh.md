# 会话列表的重载合并为一次一轮

- **Date:** 2026-09-29
- **Type:** fix
- **Scope:** `web`
- **PR:** [#87](https://github.com/Myriad-Dreamin/penguin-harness/pull/87)

[English](2026-09-29-sessions-reload-coalesce.md)

会话列表每重载一次，都要把每个来源的每个 Agent 问一遍。以前每个触发（新 Session、定时任务触发、resync）都立刻各起一轮。于是一轮还在等一台慢机器时，繁忙的 Project 仍不断加新的一轮，这些调用在浏览器里越积越多（`net::ERR_INSUFFICIENT_RESOURCES`）。现在同一时刻最多一轮在飞、一轮排队。

## 细节

- 一轮在飞时到来的触发，并入排在它后面的那一轮。那一轮在前一轮结束后才开始，并按那时的列表状态去问。其间来多少个触发，都只多花一轮。
- 换了列表的重载（切换 Project、Agent 集合变了）不排队，立即开始；被它越过的那一轮，回答照旧丢弃。
