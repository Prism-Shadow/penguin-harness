# Add core AgentAuth engine, RoleRegistry, AuthRefinerRegistry, and HTTP route authorization gate

- **Date:** 2026-11-21
- **Type:** feature
- **Scope:** `server`, `library/http`

[中文版](2026-11-21-agent-auth-core-engine.zh.md)

Added the core `AgentAuth` authorization engine, declarative `RoleRegistry`, scoped `AuthRefinerRegistry` (`@self` and `@withAsk`), `AuthRoleSessionsRepo`, and the `HttpModule` per-route authorization gate.

## Details

- Added `RoleRegistry` (`packages/server/src/auth/agent-roles.ts`) with seven built-in Agent workflow roles (`readonly`, `general`, `agent-creator`, `plugin-maintainer`, `workbench-maintainer`, `system-maintainer`, `admin`), exact route matching, role mismatch detection with fallback to `readonly`, and `sourceModule` diagnostics.
- Added `AuthRefinerRegistry`, `AuthSelfRefiner` (`@self`), and `AuthWithAskRefiner` (`@withAsk`) (`packages/server/src/auth/auth-refiners.ts`) with pre-compiled scope matching and three permission upgrade decisions (`allowed_once`, `allowed_for_agent`, `always_allowed`).
- Added `AuthRoleSessionsRepo` (`packages/server/src/db/repos/auth-role-sessions.ts`) and `AgentAuthService` / `AgentAuthPermissionProvider` (`packages/server/src/auth/agent-auth-service.ts`) with token-hash-bound temporary grants and permission upgrade state machine validation.
- Updated `HttpModule` (`packages/server/src/http/app.ts`) with `endpointOf`, single-method route contributions, `roles` / `roleBindings` / `authRefiners` slots, and active session token re-verification across async refiner boundaries.
