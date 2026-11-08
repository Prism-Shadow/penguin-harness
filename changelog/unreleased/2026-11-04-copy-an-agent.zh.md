# 复制 Agent

- **Date:** 2026-11-04
- **Type:** feature
- **Scope:** `server`, `web`, `cli`, `docs`
- **PR:** [#1456](https://github.com/Prism-Shadow/penguin-harness/pull/1456)
- **Issue:** [#1451](https://github.com/Prism-Shadow/penguin-harness/issues/1451)

[English](2026-11-04-copy-an-agent.md)

现在可以一步复制一个 Agent，不用先导出快照、再用快照新建 Agent。一个用途是用同一个 baseline 分别跑几种自进化方法。副本建在同一台服务器或机器上，从原 Agent 当前的 Agent State 开始：配置、提示词、Skill、钩子、记忆、定时任务、工作台、描述和版本号。副本不包括密钥保险柜、会话、Trace、API 密钥和工作台的版本历史，被复制的 Agent 也不会被写入任何东西，连快照都不会生成。

## 入口

- **Web App**：Agent 设置页的 **Agent State** 区块里，**导出快照**旁边新增了**复制 Agent**。对话框只问副本的名称（预填为“原名 副本”）和 id，复制完成后打开副本。Project 的任何成员都能复制。
- **CLI**：`penguin agent create --agent-id <id> --from <agent-id>`。
- **Server API**：`POST /api/projects/:p/agents` 新增 `copyFrom` 字段，不能与 `dataBase64` 同用（`copy_with_snapshot`），也不能与预装同用（`copy_with_plugins`）。
