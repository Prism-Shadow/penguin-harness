# 新增角色授权会话与权限代际数据库表

- **Date:** 2026-11-21
- **Type:** feature
- **Scope:** `library/db`
- **PR:** [#1846](https://github.com/Prism-Shadow/penguin-harness/pull/1846)

[English](2026-11-21-auth-role-sessions-schema.md)

在 `@prismshadow/penguin-library-db` 中新增 `auth_role_sessions` 与 `auth_generations` SQLite 表及热切换安全的迁移步骤 `2026-11-19-auth-role-sessions`，用于持久化受控角色授权会话令牌哈希与各主体的当前权限代际记录。

## 细节

- 在 `library/db/src/schema.ts` 与 `library/db/src/migrations/steps/2026-11-19-auth-role-sessions.ts` 中新增 `auth_role_sessions`（`token_hash TEXT NOT NULL PRIMARY KEY`）与 `auth_generations`（`subject_id TEXT NOT NULL PRIMARY KEY`）表定义及主体、Agent、用户与过期时间索引。
- 在 `library/db/test/db-migration-steps.test.ts` 中新增热切换迁移路径、全新库与迁移库结构一致性、`NOT NULL` 与主键唯一性约束、默认值、幂等 `up` 重跑及 `down` 回滚的测试覆盖。
