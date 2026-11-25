# 新增 Agent 授权端到端真实 LLM QA 测试套件与可用性测试场景

- **Date:** 2026-11-21
- **Type:** change
- **Scope:** `server`, `tests/scenarios`

[English](2026-11-21-agent-auth-live-qa-scenario.md)

新增 Agent 授权端到端真实 LLM QA 测试套件（`packages/server/test/agent-auth-live-qa.e2e.test.ts`）与可用性测试场景（`tests/scenarios/usability/agent-auth/`），验证 Agent 授权角色、`@self` 与 `@withAsk` 精化器、角色失配安全回退以及三种权限升级审批模式（`allowed_once`、`allowed_for_agent`、`always_allowed`）。

## 细节

- 新增 `packages/server/test/agent-auth-live-qa.e2e.test.ts`，在真实服务端上驱动真实 Agent 会话完成 7 种默认工作流角色、`@self` 隔离、角色失配回退至 `readonly` 以及三种权限升级审批模式的端到端验证。
- 新增 `tests/scenarios/usability/agent-auth/TASK.md` 与 `tests/scenarios/usability/agent-auth/scripts/verify-agent-auth.mjs`，并在 `tests/scenarios/README.md` 中登记 `usability/agent-auth`。
