# Agent 授权角色树、细粒度 HTTP 路由 ID 与带作用域的权限精化器

- **Date:** 2026-11-21
- **Type:** feature
- **Scope:** `server`, `cli`, `library/db`, `library/http`
- **PR:** [#1679](https://github.com/Prism-Shadow/penguin-harness/pull/1679)

[English](2026-11-21-agent-auth-role-tree-and-refiners.md)

服务端所有 `auth: "user"` 的 HTTP 端点均分配了细粒度路由 ID，Agent 会话鉴权接入了声明式角色树（`ROLE_TREE`）与带作用域的权限精化器（`<roleOrRoute>@<refinerId>`）。同时，`penguin config` 与 `penguin version` 在服务端可达时统一经由 HTTP 端点执行，由服务端 HTTP 网关作为单一授权执行点。

## 细节

- 新增 `agent_auth_sessions` 与 `agent_auth_generations` 数据表（`library/db/src/migrations/steps/2026-11-19-agent-auth-sessions.ts`）、`AgentAuthSessionsRepo` 与 `AgentAuthService`，使每个 Agent 会话按 SHA-256 令牌哈希完成认证，并在每次请求时从当前代际（`generation`）实时重算有效权限集。
- 在 `packages/server/src/auth/agent-roles.ts` 中定义了 222 个细粒度 HTTP 路由 ID（`DIRECT_HTTP_ROUTE_IDS` 与 `HTTP_GROUP_ENDPOINT_IDS`），并将消息渠道端点统一规范至 `agents.messaging.<channel>.*`（`feishu`、`telegram`、`qq`、`wechat`）。
- 构建了声明式角色树 `ROLE_TREE`，包含三层域角色阶梯（`<domain>.read` -> `<domain>.maintain` -> `<domain>.all`）与六个复合画像角色（`none`、`readonly`、`general`、`system-maintainer`、`admin`、`full-permissions`）。
- 新增 `AuthRefiner`、`AuthRefinerRegistry` 与 `"HttpModule.authRefiners"` 贡献槽（`packages/server/src/auth/auth-refiners.ts`），提供内置 `@self`（`AuthSelfRefiner`）与 `@withAsk`（`AuthWithAskRefiner`）组件、预编译 O(1) `scope` 匹配、按有序列表优先级覆盖、未定义精化器 `403 auth_refiner_undefined` 拒绝，以及会话内精化器失配时的 `403 auth_refiner_mismatch`（提示以 `admin` 权限启动 Agent 修复）。
- 更新 `penguin config`（`model`、`vault`、`platform-auth`、`modelscope-auth`、`oauth`）与 `penguin version` 在服务端运行时优先调用 HTTP API，并新增设计文档 `rfcs/PRFC-0026-authorization.md` 与 `rfcs/PRFC-0026-authorization.zh.md`。
