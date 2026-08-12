# Unreleased

- [2026-08-11] Server: the Trace index's mtime gate now stats every known date directory instead of only the newest, so a compaction-rotated shard (`rotate()` writes to the session's original date dir, not necessarily the newest) is registered instead of silently missing — `GET /messages` returns the full post-compaction conversation instead of stopping at `compaction_end`. ([details](2026-08-11-trace-index-compaction-rotate.md))
