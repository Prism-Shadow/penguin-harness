# Trace index: mtime gate catches compaction-rotated shards in non-newest date dirs

## The bug

Context compaction calls `TraceWriter.rotate()` to split the Trace into a new shard
(`_002`). The new file is written in the session's **original** date directory (the
Writer's `dateDir` is fixed at construction and never changes), which may be older than
the newest date directory on disk.

The `TraceIndexService` mtime gate optimized its hot path by stat-checking **only the
newest date directory** after confirming the root mtime was unchanged. The comment assumed
"in practice always the newest one (the Writer names dirs by current local date)."
Compaction's `rotate()` breaks this assumption: the new shard lands in an older dir whose
mtime the gate never checks, so the index never registers it.

`locateAll()` only force-reconciles when the index returns **zero** rows for a session;
since `_001` is already indexed (`rows.length = 1`), the force path never triggers. The
result: `GET /messages` returns messages only up to `compaction_end`, and the UI stays
stuck on the "compaction complete" banner — the full post-compaction conversation is
invisible until the process restarts (which forgets the in-memory gate and runs a full
diff).

## The fix

The gate now stats **every known date directory** instead of only the newest, breaking
out on the first whose mtime differs from the cached value. This is still readdir-free
(N stat calls where N is the date-dir count, typically 1–5) and preserves all existing
behavior: the unchanged-tree fast path still returns early. The remaining blind spot is
a backdated write (an external process that changes a file and resets its dir's mtime to
the cached value) — that is not covered by the gate or by `locateAll()`'s whole-session
force-retry, and remains missing until an unrelated force, explicit forced reconciliation,
or restart.

## Verification

- New regression test: a session in `2026-07-05/` with a newer date dir `2026-07-06/`
  already indexed; `rotate()` creates `_002` in the old dir; the gate catches it and the
  index registers the shard. Fails on the old code, passes on the fix.
- All four existing trace-index tests continue to pass.
- Confirmed against real data: a session `f0e639aa` with `_002` missing from the index
  returned 1937 messages (ending at `compaction_end`); after the fix, 2265 messages
  (ending at the task's final output).
