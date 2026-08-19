# Trace index: mtime gate catches compaction-rotated shards in non-newest date dirs

- **Date:** 2026-08-11
- **Type:** fix
- **Scope:** `server`, `trace-index`
- **PR:** [#271](https://github.com/Prism-Shadow/penguin-harness/pull/271)

[中文版](2026-08-11-trace-index-compaction-rotate.zh.md)

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
stuck on the "compaction complete" banner. The shard stayed missing until anything else
tripped the gate for that Agent — the next day's first Session (a new date dir moves the
root mtime), any new shard in the newest dir, an import or Session delete, or a forced
pass — because the diff loop's skip test fails for the rotate-touched dir once it does
look. In practice that bounded the window at midnight, not at the next restart.

## The fix

The gate now stats **every known date directory** instead of only the newest. The newest
dir is stat-checked first, so the common case (a fresh shard in today's dir) still settles
in one stat; the remaining dirs are stat-checked concurrently and only decide the rotate
case. This stays readdir-free, and the unchanged-tree fast path still returns early.

The trade this makes explicit: the quiet hot path is no longer a constant two stats but
one root stat plus one stat per date directory, and a date directory is created per
calendar day the Agent runs, with no pruning — so N grows with the Agent's lifetime
rather than being "a handful". The stats run concurrently, and callers that fan out over
Agents or subagent children multiply it. This supersedes the hot-path description in
`changelog/0.2.1/2026-08-04-traces-page-scaling.md` ("The hot path is two stats — an mtime
gate on the traces root and the newest date dir"), which that frozen entry still states.

Two blind spots survive, both inherent to gating on directory mtimes rather than file
ones: an **in-place append** moves no directory mtime at all (only creating or removing a
directory entry does), which is what a resumed Session does — core pins the shard and date
dir, so the run grows an existing file and its recorded `size_bytes` goes stale; and a
**backdated write**, where an external process changes a file and then resets its
directory's mtime to the cached value. `locateAll()`'s force-retry fires only on a
whole-session miss (zero indexed rows), so neither is covered for a session that already
has shards indexed: it stays stale until an unrelated force, an explicit forced
reconciliation, or a restart.
