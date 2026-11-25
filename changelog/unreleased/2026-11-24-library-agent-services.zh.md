# Agent 域的服务下沉为 agent library 包

- **日期：** 2026-11-24
- **类型：** refactor
- **范围：** `server`、`library/agent`、`library/session`

[English](2026-11-24-library-agent-services.md)

服务器的 Agent 服务、它的读视图与删除流程搬到先行的 agent 词汇包旁边。`@prismshadow/penguin-library-agent` 收入 Agent 服务（列表、创建、后台清除与插件更新面）、已装 Skills 读视图、以人身份发起任务的运行器、全链路删除流程与一次性的员工作者迁移，以及它们所讲的词汇：Agent 生命周期契约、列表卡片与创建的 DTO、受限树清除、语义 id 规则与会话标题规则（最后一件进 `@prismshadow/penguin-library-session`）。

服务器导入这些包；library 不引用服务器。搬动的服务在绑定服务器自有机制处保留服务器侧装配：插件库与其 server 模块、workbenches 迁移、目录 Skills 解析器以包内声明的结构化 port（`AgentPluginLibrary`、`AgentPluginModules`、`AgentWorkbenches`、`AgentDirectorySkills`）满足，任务运行器的会话运行时、创建路径与结果读取器也以 port（`AgentTaskRunner`、`AgentTaskSessions`、`AgentTaskOutcome`）到达。API 的导出面经再导出保持完整——服务器自身的导入路径让搬动的名字继续解析。

## 细节

- `library/agent` 增长：`agent-service`、`agent-skills`、`agent-tasks`、`agent-deletion`、`agent-author-migration`、`tree-purge`、`ids`，以及 ports 模块（`AgentPluginLibrary`、`AgentPluginModules`、`AgentWorkbenches`、`AgentDirectorySkills`、`AgentTaskRunner`、`AgentTaskSessions`、`AgentTaskOutcome`）。`AgentLifecycle` 契约搬进包的 contract 模块，包索引现在导出各服务形状。
- `library/session` 增长会话标题规则（`session-title`）——重命名与任务标题共用同一条规则。
- 列表卡片、创建与删除的 DTO（`AgentListItem`、`AgentCreation`、`AgentDeletionInfo`、`PluginUpdateRef`）搬进 agent 包的 types；服务器的 API 契约文件再导出它们，响应形状不变。

## 兼容性

本批不改行为：搬动的是同一份代码，只是换了地址。既有的服务器导入路径——`services/agent-service.ts`、`services/agent-skills.ts`、`services/agent-tasks.ts`、`services/agent-deletion.ts`、`services/agent-author-migration.ts`、`services/tree-purge.ts`、`services/ids.ts`、`mechanisms/agents.ts`、`http/session-title.ts` 与 API 契约文件——仍然导出搬动的名字（自 library 包再导出）；下次改到这些文件时换成 library 包的导入即可。
