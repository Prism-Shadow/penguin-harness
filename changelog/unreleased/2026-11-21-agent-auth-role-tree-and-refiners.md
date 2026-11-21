# Agent authorization role tree, fine-grained HTTP route IDs, and scoped auth refiners

- **Date:** 2026-11-21
- **Type:** feature
- **Scope:** `server`, `cli`, `library/db`, `library/http`
- **PR:** [#1679](https://github.com/Prism-Shadow/penguin-harness/pull/1679)

[中文版](2026-11-21-agent-auth-role-tree-and-refiners.zh.md)

Every `auth: "user"` HTTP endpoint on the server received a fine-grained route ID, and Agent session authorization was wired through a declarative Role Tree (`ROLE_TREE`) and scoped auth refiners (`<roleOrRoute>@<refinerId>`). In addition, `penguin config` and `penguin version` were routed over the server's HTTP endpoints when a server is reachable, keeping the HTTP gate as the single authorization enforcement point.

## Details

- Added `agent_auth_sessions` and `agent_auth_generations` tables (`library/db/src/migrations/steps/2026-11-19-agent-auth-sessions.ts`), `AgentAuthSessionsRepo`, and `AgentAuthService` so each Agent session authenticates by SHA-256 token hash and re-derives its effective grant from the Agent's current generation on every request.
- Assigned 222 fine-grained HTTP route IDs (`DIRECT_HTTP_ROUTE_IDS` and `HTTP_GROUP_ENDPOINT_IDS` in `packages/server/src/auth/agent-roles.ts`), normalizing messaging channel endpoints under `agents.messaging.<channel>.*` (`feishu`, `telegram`, `qq`, `wechat`).
- Built the declarative `ROLE_TREE` with three-tier domain roles (`<domain>.read` -> `<domain>.maintain` -> `<domain>.all`) and composite persona roles (`none`, `readonly`, `general`, `system-maintainer`, `admin`, `full-permissions`).
- Added `AuthRefiner`, `AuthRefinerRegistry`, and the `"HttpModule.authRefiners"` contribution slot (`packages/server/src/auth/auth-refiners.ts`), with built-in `@self` (`AuthSelfRefiner`) and `@withAsk` (`AuthWithAskRefiner`) components, pre-compiled O(1) `scope` matching, priority-ordered list overrides, `403 auth_refiner_undefined` rejection for unknown refiners, and `403 auth_refiner_mismatch` admin-repair guidance on session scope mismatches.
- Updated `penguin config` (`model`, `vault`, `platform-auth`, `modelscope-auth`, `oauth`) and `penguin version` to call the server's HTTP APIs when a running server is available, and added `rfcs/PRFC-0026-authorization.md` and `rfcs/PRFC-0026-authorization.zh.md`.
