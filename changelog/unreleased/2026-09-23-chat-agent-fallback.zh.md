# Agent 不在本服务器列表里的对话也能渲染

- **Date:** 2026-09-23
- **Type:** fix
- **Scope:** `web`
- **PR:** [#834](https://github.com/Prism-Shadow/penguin-harness/pull/834)

[English](2026-09-23-chat-agent-fallback.md)

打开 Agent 跑在机器上的组织工位时，对话页会永远停在 Agent 占位骨架上——无报错、无警告，刷新也无济于事。

## Details

- 对话页现在按路由 Session 自己的 Agent id 渲染。此前按「当前 Agent」渲染，而只有本服务器的 Agent 列表里有该
  Agent 时才会把 Session 的 Agent 采纳为当前 Agent；只在机器上的 Agent 永远不在这个列表里，且只有直接查询那条
  路径会重取列表，已列出的 Session 根本走不到那里。
- Session 的 Agent 未被采纳为当前 Agent 时，以 `console.warn` 报出该 Agent 与 Session，每个 Session 一次。
