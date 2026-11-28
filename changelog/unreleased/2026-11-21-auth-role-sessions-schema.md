# Add auth role session and permission generation database tables

- **Date:** 2026-11-21
- **Type:** feature
- **Scope:** `library/db`
- **PR:** [#1846](https://github.com/Prism-Shadow/penguin-harness/pull/1846)

[中文版](2026-11-21-auth-role-sessions-schema.zh.md)

Added the `auth_role_sessions` and `auth_generations` SQLite tables and the `2026-11-19-auth-role-sessions` swap-safe migration step in `@prismshadow/penguin-library-db` to store role-bound authorization session token hashes and per-principal permission generations.

## Details

- Added `auth_role_sessions` (`token_hash TEXT NOT NULL PRIMARY KEY`) and `auth_generations` (`subject_id TEXT NOT NULL PRIMARY KEY`) to `library/db/src/schema.ts` and `library/db/src/migrations/steps/2026-11-19-auth-role-sessions.ts`, along with subject, agent, user, and expiration indexes.
- Added swap-path migration, schema parity, `NOT NULL` and primary-key uniqueness, default value, idempotent `up`, and rollback `down` test coverage in `library/db/test/db-migration-steps.test.ts`.
