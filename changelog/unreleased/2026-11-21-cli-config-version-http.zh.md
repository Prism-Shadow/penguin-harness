# 将 CLI config 与 version 命令改为经由 HTTP 执行并加固客户端凭据边界

- **Date:** 2026-11-21
- **Type:** feature
- **Scope:** `cli`, `library/cli`, `server`

[English](2026-11-21-cli-config-version-http.md)

`penguin config`（`model`、`set`、`list`、`unset`）与 `penguin version --json` 现通过服务端 HTTP 端点（`/api/projects/:projectId/models`、`/api/projects/:projectId/agents/:agentId/vault` 与 `/api/version`）执行，同时 CLI 客户端在显式指定 `--root` 时保持令牌隔离，并阻止 Agent 子进程回退至人类登录会话 Cookie。

## 细节

- 在 `vaultRoutes` 与 `AgentConfigService` 中新增 `PUT /api/projects/:projectId/agents/:agentId/vault/entries/:key` 与 `DELETE /api/projects/:projectId/agents/:agentId/vault/entries/:key`，使单键 Vault 写入与删除经由 HTTP 执行。
- 更新 `penguin config`（`set`、`list`、`unset`）、`penguin config model`（`add`、`default`、`vision`、`list`、`remove`）及 `penguin version --json` 通过 `ServerClient` 调用服务端 HTTP 路由。
- 更新 `resolveConnection`（`library/cli/src/connection.ts`），使显式传入 `--root` 并搭配本机回环 `--server` 时优先读取 `<root>/api-token` 而非环境变量 `PENGUIN_API_TOKEN`；更新 `ServerClient`（`library/cli/src/client.ts`），使 `tokenSource === "env"` 或处于 Agent 子进程环境（`PENGUIN_AGENT_ID` / `PENGUIN_SESSION_ID`）的请求在遇到 `403 human_required` 时绝不回退使用人类登录 Cookie 重试。
