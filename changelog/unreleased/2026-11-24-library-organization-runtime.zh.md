# organization 域的运行时并入 library 包

- **Date:** 2026-11-24
- **Type:** refactor
- **Scope:** `server`, `library/organization`, `library/agent`, `core`

[English](2026-11-24-library-organization-runtime.md)

organization 域的文件词汇、运行时与契约搬到它们之前的词汇包旁边。`@prismshadow/penguin-library-organization` 收下组织的文件词汇（org config、chart、工单、频道与手册的读写器）、运行时服务及其调度器、reconcile pass 与触发器、连同员工的 Agent 一起删除组织的删除流程，以及 `/api/projects/:projectId/organizations` 背后的路由工厂；组织的 API DTO 一并搬入，Agent 删除的 DTO 并入 `@prismshadow/penguin-library-agent`。创建者手打的 id 要答的 semantic id 模式并入 `@prismshadow/penguin-core`。

服务端 import 这些包；library 里没有任何代码反向 import 服务端。搬动的服务在绑定服务端能力的地方保留原装配：绑定 runtime deps 接缝的 Module、路由的模块节点与 Agent 删除的步骤留在原地，服务通过 deps 端口指名它需要什么。API 的导出面通过 re-export 保持完整——仍在使用的仓内转发让旧 import 路径继续可用——其余一律直接 import library 包。

## Details

- `library/organization` 增：org 文件词汇（`org_config.toml`、`org_chart.yaml`、工单、频道、手册、路径、principal、工单 id、时区算术）、运行时服务及其调度器、reconcile、model、notices、budget、digest、locks 与 triggers、`OrgRuns`／`OrgSessions`／`OrgScheduler`／`OrgService` 契约、organization-deletion 流程、organization 路由工厂，以及 company mode 的 API DTO。
- `library/agent` 增：Agent 删除的 DTO（`AgentDeletionInfo` 与两个删除应答）。
- `core` 增：semantic id 模式（`SEMANTIC_ID_PATTERN`），落在 id 规则旁边。
- 涉及的每个接口类都以 `@Interface` 装饰器声明成员。
