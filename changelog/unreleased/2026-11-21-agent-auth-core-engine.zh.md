# 新增核心 AgentAuth 授权引擎、RoleRegistry、AuthRefinerRegistry 与 HTTP 路由授权门禁

- **Date:** 2026-11-21
- **Type:** feature
- **Scope:** `server`, `library/http`

[English](2026-11-21-agent-auth-core-engine.md)

新增核心 `AgentAuth` 授权引擎、声明式角色注册表 `RoleRegistry`、带作用域的精化器注册表 `AuthRefinerRegistry`（`@self` 与 `@withAsk`）、`AuthRoleSessionsRepo` 以及 `HttpModule` 按路由授权门禁。

## 细节

- 新增 `RoleRegistry`（`packages/server/src/auth/agent-roles.ts`），包含 7 个内置工作流角色（`readonly`、`general`、`agent-creator`、`plugin-maintainer`、`workbench-maintainer`、`system-maintainer`、`admin`）、精确路由匹配、角色失配检测与安全回退至 `readonly`，以及 `sourceModule` 诊断信息。
- 新增 `AuthRefinerRegistry`、`AuthSelfRefiner`（`@self`）与 `AuthWithAskRefiner`（`@withAsk`）（`packages/server/src/auth/auth-refiners.ts`），支持预编译作用域匹配与三种权限升级审批模式（`allowed_once`、`allowed_for_agent`、`always_allowed`）。
- 新增 `AuthRoleSessionsRepo`（`packages/server/src/db/repos/auth-role-sessions.ts`）与 `AgentAuthService` / `AgentAuthPermissionProvider`（`packages/server/src/auth/agent-auth-service.ts`），支持绑定活跃会话令牌哈希的临时授权与权限升级状态机校验。
- 更新 `HttpModule`（`packages/server/src/http/app.ts`），提供 `endpointOf`、单 Method 路由贡献、`roles` / `roleBindings` / `authRefiners` 贡献槽，并在异步精化器边界前后复验活跃会话令牌。
