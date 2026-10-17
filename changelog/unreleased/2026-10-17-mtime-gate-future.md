# A future directory mtime no longer wedges the derived-cache gate

- **Date:** 2026-10-17
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1181](https://github.com/Prism-Shadow/penguin-harness/pull/1181)
- **Issue:** [#301](https://github.com/Prism-Shadow/penguin-harness/issues/301)

[中文版](2026-10-17-mtime-gate-future.zh.md)

The shared mtime gate used by the Trace index, schedule scans and project-config reads now treats a timestamp in the future as stable. A restored backup, `rsync -t` from a faster clock, or NTP skew no longer forces a full directory scan on every request until the wall clock catches up.

## Details

- `cacheable()` records a future mtime as itself. Only an mtime younger than two seconds — a path that may still be growing — stays the never-matching sentinel.
- The same-tick freshness window is unchanged: a just-written path is still re-read until it has been quiet.
