# A Trace shard is parsed once, not once per read

- **Date:** 2026-10-18
- **Type:** fix
- **Scope:** `server`

[中文版](2026-10-18-trace-shard-cache.zh.md)

Reading a Session's history parsed every shard it touched from disk, again, on every request. The conversation pane re-reads the same window on each focus, the fork and outline paths re-read whole shards, and an active Session's newest shard changes between two reads — so a Session with a few hundred megabytes of Trace paid its parse cost repeatedly, on the request path, for a transcript that had not changed.

## What changed

- `TraceService.readShard` — the one funnel every shard read goes through — now serves a parse from a cache keyed by the shard's path.
- A hit is validated, not assumed. The file must be at least as long as what was parsed, and the 64 bytes just before that offset are re-read and compared with what was parsed; a shard that shrank, was edited in place, or was replaced at the same path by an import is read again. File identity is deliberately not used — an inode number is reused, and a replaced file whose parsed prefix is byte-identical is safe to keep building on.
- Shards are append-only (core's Writer opens `O_APPEND`, one `write(2)` per record, never seeks), so an append parses only the appended bytes: the Session being written right now costs its new tail instead of the whole file. Only complete lines advance the offset, so a crash-torn trailing line is still read once the writer completes it.
- Bounds: 512 shards or 64 MiB of parsed bytes, LRU by re-insertion. A history larger than the bounds degrades to re-reading shards, never to serving the wrong ones.
- Callers get a shallow copy, as they did before — several of them splice or sort the array into the shape they need.
- `observeShardRead` keeps reporting demand (a cache hit still touches the shard, which is what the windowed-read tests assert), and a new `observeShardParse` reports the parses themselves.

## Effect

On a real 14-shard, 14 488-message Session, repeated reads of the same history went from ~130 ms each to ~8 ms, and a repeated tail window (the pane's shape) from ~105 ms to ~40 ms; a read right after an append went from ~122 ms to ~9 ms. The window keeps its remaining cost because the per-shard scan that follows the parse is not cached — only the parse is.
