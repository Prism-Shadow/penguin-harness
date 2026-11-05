# 删除公司时可以一并删除它的 Agent，Agents 页面随即看到变化

- **Date:** 2026-11-04
- **Type:** fix
- **Scope:** `server`, `web`, `docs`
- **PR:** [#1481](https://github.com/Prism-Shadow/penguin-harness/pull/1481)

[English](2026-11-04-company-delete-agents.md)

删除组织时新增一个选项：一并删除员工的 Agent，默认勾选。组织删除或新建、员工招募或离任之后，Web App 会重新读取 Agent 列表，Agents 页面的删除按钮、侧栏和 Agent 选择器因此立即看到新的任职情况，不必等到刷新。

## 服务端

- `DELETE /api/projects/:projectId/organizations/:orgId` 接受 `?deleteAgents=1`，返回 200 和一份报告（此前为 204）：`deletedAgents`（各带其后台删除进度）、`keptAgents`（`employed_elsewhere` 或 `builtin`）和 `failedAgents`（带错误的 code 与 message）。组织仍先移入 Project 的回收目录。
- 带这个参数时，每名员工的 Agent（包括 CEO 的）逐个删除，与 `DELETE …/agents/:agentId` 删除单个 Agent 完全一样。另一个组织也雇用的 Agent 和内置 Agent 保留；删除被拒绝的 Agent（例如文件夹无法移走）列入报告，其余照常删除。
- Agent 的删除链从 Agents 路由移到 `services/agent-deletion.ts`，两条路由共用；单个 Agent 的删除行为不变。

## Web App

- 组织设置里的删除确认框在打开时重新读取 Agent 列表，在默认勾选的**同时删除该公司的 Agent** 复选框下列出将永久删除的 Agent 和保留的 Agent 及其原因；仍需输入组织 id 才能删除。删除之后，每个被删 Agent 的后台清理照常显示在进度卡片上，未能删除的 Agent 在错误提示中点名。
- 组织删除（无论是否勾选）或新建之后，以及招募、离任之后，都会重新读取 Agent 列表。
- 确认框的说明、删除一行的帮助和暂停的帮助不再说组织永远不会被删除。
