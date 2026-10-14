# Backward compatibility: numbered migration stamps

- **Date:** 2026-10-02
- **Type:** process
- **Scope:** `server`
- **PR:** [#187](https://github.com/Myriad-Dreamin/penguin-harness/pull/187)

[中文版](2026-10-02-backward-compatibility-named-migrations.zh.md)

[Database migrations are named and recorded in a ledger](2026-10-02-named-migrations.md) replaced the number stamp a `web.db` carried. Every existing data root still carries that stamp.

## The old shape: a `user_version` stamp and no ledger

Before this change a database recorded its progress as one number in `PRAGMA user_version`. Different lines numbered their migrations differently, so the same number could mean different migrations on two roots.

Chosen: **adopt the root on first open.** A database without the `schema_migrations` table runs every migration once — each one is a no-op where its work is already done — and all of their names are recorded. `user_version` is not read, because its meaning depends on the line that wrote it, and it is not written any more; it keeps the value the last numbered build left. This applies to every data root: release, desktop, CLI and development roots, and the roots of machines a server hands its build to. The adoption happens on the runtime's start and on a hot push alike.

**A user is not required to do anything.**

One limit: a database created by a build with the ledger has `user_version` 0. Pushing a build from before the ledger onto such a root is refused as needing a restart, because the older build reads 0 as "nothing applied". Push a build with the ledger instead.

## When this can be removed

The adoption path can be removed once no supported data root can still lack the ledger. The release that sets that baseline owns the removal; until then it costs one table lookup per open. Repair migrations that exist only to fix a root stamped under another line's numbering become redundant with it and go at the same time.
