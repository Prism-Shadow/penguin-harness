# A transient filesystem error is not a deleted path

- **Date:** 2026-10-17
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1183](https://github.com/Prism-Shadow/penguin-harness/pull/1183)
- **Issue:** [#301](https://github.com/Prism-Shadow/penguin-harness/issues/301)

[中文版](2026-10-17-mtime-gate-missing-path.zh.md)

The Trace index, schedule scans and agent-dir listing no longer treat every filesystem error as "this path is gone". A transient `EACCES` / `EMFILE` / `EIO` used to delete index rows (or empty the schedule list) and then record the pass as clean, so the loss stuck until restart. Those errors now fail the pass; the last good cache stays.

## Details

- `statMtime()` returns null only for ENOENT, matching its own comment, and rethrows anything else.
- Trace-index directory listings and per-shard stats, schedule-file reads, and the scheduler's agent listing do the same: missing is missing; any other errno aborts before rows are swept.
