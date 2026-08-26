# The web.db upgrade directions are pinned by tests

- **Date:** 2026-08-27
- **Type:** process
- **Scope:** `server`
- **PR:** [#483](https://github.com/Prism-Shadow/penguin-harness/pull/483)

[中文版](2026-08-27-web-db-upgrade-direction-tests.zh.md)

`openDatabase` had coverage for one of the three shapes a released build meets on disk: a
`sessions` table formed before a column existed. Two more were added, both derived from the real
`SCHEMA_SQL` rather than a hand-copied DDL replica, in the style the file already used.

## Details

- A database formed before `messaging_bindings` existed — every `web.db` written by 0.2.4 or
  earlier — gets the table and its `idx_messaging_account` uniqueness index on open, keeps the
  Sessions that were already there, and accepts a binding immediately afterwards. Uniqueness is
  asserted on a raw `INSERT` that goes around `MessagingBindingsRepo`'s own pre-check, which is
  the only write that reaches the index rather than the repo's SELECT.
- A database written by a **newer** build, opened by this one: an unknown table, an unknown
  column on `sessions` and an index over that column all survive the open untouched, and this
  build goes on reading and writing the rows it does own. This is the shape a user produces by
  updating, disliking the update and reinstalling the previous release.
- Where that tolerance stops is pinned next to it: two changes that add and remove nothing — a
  `NOT NULL` column with no default on a table this build writes, and a new unique index over
  columns it already writes — leave the open succeeding and the first write failing.

The tests state the condition each direction depends on, at the point a future schema change
would break it.
