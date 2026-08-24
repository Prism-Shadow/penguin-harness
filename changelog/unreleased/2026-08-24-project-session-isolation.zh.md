# 将深链接 Session 限制在所属 Project 内

- **Date:** 2026-08-24
- **Type:** fix
- **Scope:** `web`
- **PR:** [#435](https://github.com/Prism-Shadow/penguin-harness/pull/435)

[English](2026-08-24-project-session-isolation.md)

Web App 在深链接 Session 属于其他 Project 时拒绝载入，而不会再将其插入当前 Project 的对话列表。

## 细节

- 将 Session 直接查询结果限制在当前选择的 Project 内。
- 以 Project 和 Session 共同标识深链接查询失败状态，避免切换 Project 后复用过期状态。
