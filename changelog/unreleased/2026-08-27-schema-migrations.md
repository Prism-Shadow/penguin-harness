# Schema changes are migrations now, and travel with the platform

- **Date:** 2026-08-27
- **Type:** feature
- **Scope:** `server`
- **PR:** [#383](https://github.com/Prism-Shadow/penguin-harness/pull/383)

[中文版](2026-08-27-schema-migrations.zh.md)

`schema.ts` declares the shape a fresh database is created with; it cannot express a change. Re-running `CREATE TABLE IF NOT EXISTS` converges a database toward the current declaration without knowing which state it came from, so no build could tell a 0.2.4 database from a 0.2.7 one and every change had to be additive to be safe at all. Schema changes are ordered migrations now, each stamped into `PRAGMA user_version`, and a pushed platform carries its own — which is how a table reaches a runtime older than the feature that needs it.

## Details

- A migration spells out its own frozen DDL and never imports `SCHEMA_SQL`: referring to the live declaration would make an old migration mean something new every time the schema moves. Versions are contiguous from 1 and are never renumbered or edited once released, so a stamp names an unambiguous state.
- Each migration and its version stamp commit in one transaction, so an interrupted run leaves the database at the last version that fully applied — never half-migrated.
- `swapSafe` is the axis hot updates require. A pushed platform boots against a live database and is rolled back to its predecessor if it fails, leaving that predecessor on whatever the migration already did. Additive work survives; narrowing work does not. The runtime's own open may apply anything, while a booting platform applies only `swapSafe` migrations and refuses the rest **whole**, before touching the database, with `RestartRequiredError`.
- Two migrations so far, both additive: 0.2.4 → 0.2.7 adds the `messaging_bindings` table and three indexes, and 0.2.7 → 0.2.8 adds that table's `final_reply_only` and `render_markdown` columns. A 0.2.4 database that has run them holds the same schema a current build creates from scratch — the same tables, columns, types, constraints and indexes. Column *order* can differ, because `ALTER TABLE ADD COLUMN` appends while a fresh database gets the column where the declaration puts it; matching it would mean rebuilding the table, which is not additive.
- Databases formed before migrations existed all read version 0 while sitting in different shapes, so version 1 tolerates finding its work already done. Migrations from version 2 on meet a known prior state and do not.
