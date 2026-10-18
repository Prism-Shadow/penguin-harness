# A Session's newest shard is found by name before a forced reconcile

- **Date:** 2026-10-18
- **Type:** fix
- **Scope:** `server`

[中文版](2026-10-18-latest-trace-lookup.zh.md)

`SessionService.latestTracePath` reconciles the Trace index and, when the index has no shard for the Session, runs a FORCED reconcile — a walk over the Agent's whole Trace tree. A brand-new Session pays that walk on every open until its rows land, and an Agent with thousands of shards turns each one into seconds.

## What changed

- `latestShardOnDisk` (in `services/trace-index.ts`) answers the same question from the disk the index is derived from: shards are `<sessionId>_<index:03>.jsonl` under `<tracesDir>/<date>/`, so one readdir per date directory finds the highest-index shard with no stat and no read. It scans every date directory rather than the newest one alone, because a compaction `rotate()` writes the higher index into the Session's original date directory.
- `latestTracePath` tries that lookup on an index miss FIRST, and only forces the reconcile when nothing on disk carries the Session's name. The consumers' rule is unchanged: a stale index still costs one extra scan, never a missing resume shard.
- The method's answer is cached for 3 s, negative answers included — a Session with no Trace yet pays the forced reconcile on every open, which is the cost worth amortizing. The map is dropped wholesale once it passes 2000 entries.
- `traceFilePath` now shares the shard-path builder with the new lookup, so both name a shard the same way.

## Effect

Opening a Session whose shard is on disk but not yet indexed answers in milliseconds instead of walking the Agent's Trace tree; a burst of calls for the same Session (the detail page and the model switch) is answered from the cache.
