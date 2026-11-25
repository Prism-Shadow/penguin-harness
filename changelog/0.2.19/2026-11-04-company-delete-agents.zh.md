# 删除公司时可以一并删除它的 Agent，Agents 页面随即看到变化

- **Date:** 2026-11-04
- **Type:** feature
- **Scope:** `server`, `web`, `docs`
- **PR:** [#1481](https://github.com/Prism-Shadow/penguin-harness/pull/1481)
- **Breaking:** yes — `DELETE /api/projects/:projectId/organizations/:orgId` 返回 200 和一份报告，不再是不带内容的 204

[English](2026-11-04-company-delete-agents.md)

删除组织时新增一个选项：一并删除员工的 Agent，默认勾选。组织删除或新建、员工招募或离任之后，Web App 会重新读取 Agent 列表，Agents 页面的删除按钮、侧栏和 Agent 选择器因此立即看到新的任职情况，不必等到刷新。

## 服务端

- `DELETE /api/projects/:projectId/organizations/:orgId` 接受 `?deleteAgents=1&agentIds=a,b`（调用方确认框列出的待删 Agent），返回 200 和一份报告：`deletedAgents`（各带其后台删除进度）、`keptAgents` 和 `failedAgents`（带错误的 code 与 message）。带 `deleteAgents=1` 却没有 `agentIds` 时返回 400，什么都不动。组织仍先移入 Project 的回收目录。
- 列出的每名员工的 Agent（包括 CEO 的）与 `DELETE …/agents/:agentId` 删除单个 Agent 完全一样地删除。其余员工保留并注明原因：`builtin`；另一个组织也雇用它时为 `employed_elsewhere`；另一个组织的 `org_chart.yaml` 无法读取期间，所有员工都为 `employment_unknown`，报告的 `unreadableCharts` 点名这些组织；不在 `agentIds` 里时为 `not_confirmed`（例如确认框读取列表之后才招募的 Agent）。`agentIds` 中不是本组织员工的 id 被忽略。删除被拒绝的 Agent（例如文件夹无法移走）列入报告，其余照常删除。
- Agent 列表（`GET /api/projects/:projectId/agents`）以 `unreadableCharts` 点名员工树无法读取的组织。
- 被删 Agent 的运行一并中止、共用一次至多五秒的等待，此后每个 Agent 只是一次文件夹改名和删除对应的行，文件在后台删除，因此应答不必等待它们的文件夹删完。
- Agent 的删除链从 Agents 路由移到 `services/agent-deletion.ts`，两条路由共用；单个 Agent 的删除行为不变。

## Web App

- 组织设置里的删除确认框在打开时重新读取 Agent 列表，在默认勾选的**同时删除该公司的 Agent** 复选框下列出将永久删除的 Agent 和保留的 Agent 及其原因。列表到达之前无法确认删除；读取失败时复选框保持不勾选，仍可只删除组织，「重试」会重新读取。另一个组织的员工树无法读取时，确认框会提前说明，并把所有员工列为保留。仍需输入组织 id 才能删除，删除进行中确认框无法关闭。
- 请求带上确认框列出的 Agent。删除之后，每个被删 Agent 的后台清理照常显示在进度卡片上；与确认框所列不符而被保留的 Agent 在提示中点名并说明原因（确认之后情况有变，或另一个组织的员工树无法读取），未能删除的 Agent 在错误提示中点名。应答失败时会重新读取该组织：它已不在时，对话框关闭并离开其页面，与删除成功一样。
- 组织删除（无论是否勾选，应答失败时也一样）或新建之后，以及招募、离任之后，都会重新读取 Agent 列表。
- 确认框的说明、删除一行的帮助和暂停的帮助不再说组织永远不会被删除。

## 兼容性

- 删除组织并期待不带内容的 `204` 的 API 客户端，现在会收到带 JSON 报告的 `200`，应改为接受任意 2xx。不带 `deleteAgents` 的请求仍只删除组织本身。Web App 在同一版本中已更新，`penguin` CLI 没有删除组织的命令。
