# Backward compatibility: the Session surface column reaches a running deployment

- **Date:** 2026-09-05
- **Type:** fix
- **Scope:** `server`
- **PR:** [#626](https://github.com/Prism-Shadow/penguin-harness/pull/626)

[中文版](2026-09-05-backward-compatibility.zh.md)

The session surface work ([2026-09-05-session-surface.md](2026-09-05-session-surface.md)) adds one column to an existing table — `sessions.surface`, `NULL` for every conversation. This entry records how that column reaches databases that already exist.

## What the old shape is, and how it is tolerated

A database written before this change has a `sessions` table with no `surface` column. It reaches the new shape two ways, and it needs both:

- **A restart** applies `openDatabase`'s declarative column list, as every additive column here has.
- **A hot push** applies migration 6 (`sessions-surface`), which is `swapSafe`. This is the one that matters: the declarative list runs when the PROCESS starts, and a push never restarts the runtime. Without the migration, a pushed platform would write `surface` to a table that has no such column, and every session insert would fail — creation, fork, subagent registration, and the Trace adoption the session list hydrates through.

## Scope, and whether anyone has to act

Nobody has to act: the column is added in place, nullable, and existing rows read as ordinary conversations. Both a restart and a push converge on the same shape, in either order — the migration is idempotent (`ensureColumn`), and a database that already grew the column through the declarative track is left alone.

A platform rolled back to a build from before this change finds a column it does not know and never touches it, which is why the migration's `down` is deliberately a no-op rather than a `DROP`: dropping it would discard which surface every surface Session is.

## When it can be removed

Never, and there is nothing to clean up: a migration is a permanent record of a shape change, not a compatibility shim. `SCHEMA_SQL` declares the column for fresh databases, migration 6 carries it to existing ones, and both stay.
