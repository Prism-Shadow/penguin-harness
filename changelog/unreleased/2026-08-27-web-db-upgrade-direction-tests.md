# The web.db upgrade directions are pinned by tests

- **Date:** 2026-08-27
- **Type:** process
- **Scope:** `server`

[中文版](2026-08-27-web-db-upgrade-direction-tests.zh.md)

`openDatabase` had coverage for one of the three shapes a released build meets on disk: a
`sessions` table formed before a column existed. Two more were added, both derived from the real
`SCHEMA_SQL` rather than a hand-copied DDL replica, in the style the file already used.

## Details

- A database formed before `messaging_bindings` existed — every `web.db` written by 0.2.4 or
  earlier — gets the table and its `idx_messaging_account` uniqueness index on open, keeps the
  Sessions that were already there, and accepts a binding immediately afterwards. The second
  `upsert` in the test claims an account another Session already holds, so the index is asserted
  to be enforcing rather than merely present.
- A database written by a **newer** build, opened by this one: an unknown table, an unknown
  column on `sessions` and an index over that column all survive the open untouched, and this
  build goes on reading and writing the rows it does own. This is the shape a user produces by
  updating, disliking the update and reinstalling the previous release.

Nothing stamps a schema version on `web.db`, so the second property holds only while every
schema change stays additive. The test states that condition at the point where a future change
would break it.
