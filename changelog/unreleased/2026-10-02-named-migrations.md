# Database migrations are named and recorded in a ledger

- **Date:** 2026-10-02
- **Type:** refactor
- **Scope:** `server`
- **PR:** [#187](https://github.com/Myriad-Dreamin/penguin-harness/pull/187)

[中文版](2026-10-02-named-migrations.zh.md)

The server's `web.db` migrations lost their numbers. Each migration is identified by its name, and a new `schema_migrations` table records, by name, which migrations a database has run. When the runtime starts and when a pushed platform boots, every migration the ledger lacks is applied in declaration order, each in one transaction with its ledger row. A build ignores names it does not declare, so migrations added on different lines no longer collide on a number. Existing data roots are adopted on first open; see [backward compatibility](2026-10-02-backward-compatibility-named-migrations.md).

## Details

- Every migration is re-runnable. `company-mode-org-caches` no longer recreates the two chat tables once `company-mode-channels` has replaced them; the other migrations were already guarded.
- Every migration is an expand (additive) or a contract (removes what no platform uses). A hot push applies the expands and leaves contracts pending for the runtime's next restart, so it never refuses on a migration and never runs a contract. `drop-goal-state` is the only contract. One expand predates the rule and still removes something: `company-mode-channels` drops the two chat tables in the step that creates the channel tables replacing them, on a hot push as well. Company mode is unreleased, and those rows are rebuilt from the organization's files or cost one pass of everything reading as unread.
- Rolling back reverts migrations in the reverse of the order they were applied, by name.
- `packages/server/src/db/migrations.ts` was split into `db/migrations/`: the runner, the ordered list, and one file per migration.
