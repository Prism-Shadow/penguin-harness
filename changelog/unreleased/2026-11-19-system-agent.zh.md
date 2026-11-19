# 每个 Project 都有系统 Agent

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `core`, `server`, `web`
- **PR:** [#1654](https://github.com/Prism-Shadow/penguin-harness/pull/1654)

[English](2026-11-19-system-agent.md)

每个 Project 新增第三个内置 Agent `system_agent`，界面名「系统」。系统应用（模型库、插件市场、机器管理、成本中心与评估中心）移入应用中心之后归它所有。它不运行对话、不装插件，不能删除、改名、导出或被导入覆盖（设计：[PRFC-0033](https://github.com/Prism-Shadow/penguin-harness-design/pull/496)）。

## 细节

- **供给。** 新建的 Project 在 `default_agent` 旁供给系统 Agent：默认模板、不装插件，`system_config.yaml` 带 `system: true`。此前建的 Project 在其 Agent 列表第一次被读取时补齐，卡片与其他内置 Agent 排在一起。系统 Agent 即 id 为 `system_agent` 且配置带此键的 Agent，由 core 的 `state/system-agent.ts` 判定，各处检查都经它。
- **拒绝。**
  - 在它上面建 Session 即 409 `system_agent_no_sessions`。检查位于会话服务的创建路径，Web App、CLI、AMSP、定时任务、组织与 Workbench 都经由它；它的 Agent API 设置与密钥同为此 409。
  - 向它安装插件即 409 `system_agent_closed`。
  - 删除它即 409 `cannot_delete_builtin_agent`。
  - 修改它的名称、描述或作者、导出它、以覆盖方式导入到它，均为 409 `builtin_agent_locked`。
  - 在尚未补齐它的 Project 里以 `system_agent` 为 id 新建 Agent 即 409 `agent_id_reserved`。
- **Agent 列表。** `AgentSummary.system` 与 `AgentConfigDto.system` 标出它；Workbench 的 `host.listAgents()` 不含它；把它的配置还原为默认值后它仍是系统 Agent。
- **Web App。**
  - Agents 页有一张「系统」卡片：名称与描述取自界面词典，没有新建对话、成本与导出，删除同内置 Agent 置灰。
  - 它的设置页只有只读的「概览」与将列出系统应用的「插件」标签页。
  - 所有选择 Agent 的位置都不提供它：新对话的选择器、`/agent`、Project 的新对话默认 Agent、Benchmark 被测 Agent、插件市场的「管理安装」、公司招聘、轨迹导入与各处「用 AI 创建」。它没有侧栏分组，不会成为当前 Agent，也不计入内核更新提示。
  - 本服务端不列出机器自己的系统 Agent。
- **已有名为 `system_agent` 的 Agent** 仍是用户自己的；Agents 页请 Project 的 owner 把它换到另一个 id，见[向后兼容](2026-11-19-backward-compatibility.zh.md)。
