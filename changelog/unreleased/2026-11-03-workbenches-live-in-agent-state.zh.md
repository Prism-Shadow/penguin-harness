# Workbench 移入 Agent State

- **Date:** 2026-11-03
- **Type:** refactor
- **Scope:** `core`, `server`
- **PR:** [#1442](https://github.com/Prism-Shadow/penguin-harness/pull/1442)

[English](2026-11-03-workbenches-live-in-agent-state.md)

Agent 的 Workbench 从 `<agentDir>/workbenches/<id>/` 移入其 Agent State，位于 `<agentDir>/agent_state/workbenches/<id>/`，与 Skill、hook 并列。目录内容不变：源码、`ui/`、`state.json`，以及服务端写入的 `.harness/` 与 `.build/`。旧位置的目录在首次访问时移入，见[向后兼容](2026-11-03-backward-compatibility.zh.md)。

## 细节

- core 新增 `workbenchesDir(root, projectId, agentId)` 指向新路径。Plugin 携带的 Workbench 安装到这里，服务端的 Workbench 存储、目录监听与 Agent 列表的 `workbenchCount` 都从这里读取。
- Workbench 位于 Agent State 内，因此 Agent State 快照以及 Agent 的导出与导入都会带上它们，包括 `state.json`。
- 没有 Workbench 的 Agent 仍然没有 `workbenches/` 目录，直到第一个 Workbench 被创建或安装。
