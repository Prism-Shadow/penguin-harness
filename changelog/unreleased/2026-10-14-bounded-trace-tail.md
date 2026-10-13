# A long conversation opens by reading its tail, and a Trace shard has a size ceiling

- **Date:** 2026-10-14
- **Type:** fix
- **Scope:** `core`, `server`, `web`
- **PR:** [#1115](https://github.com/Prism-Shadow/penguin-harness/pull/1115)

[中文版](2026-10-14-bounded-trace-tail.zh.md)

Two costs that grow with a conversation's length: opening one parsed the whole Trace shard it lives in, and a shard itself had no ceiling — one Session that ran for weeks could grow a single `.jsonl` file without bound, and every read of it paid for the whole file.

## The read

- **A historical conversation is opened from the shard's TAIL** (`server/internal/trace-tail.ts`): the file is read backwards in bounded windows until the requested history is covered, instead of parsing every record from byte 0. What a window read must not lose is what the fix in the same series pins: the paging cursor and `tracePosition` a caller resumes from, and the fact that a cut window is a suffix of the transcript rather than a re-ordered copy of it.
- **`before` paging walks a line index** rather than re-scanning from the head of the shard on every page.
- **The Web App's fork lookup** uses the same windowed read instead of pulling the whole conversation to find where to branch.

## The shard

`core`'s Trace writer gives a shard a byte ceiling: when it would grow past it, the writer rotates to the next shard (`<sessionId>_<NNN>.jsonl`) at a record boundary, so a Session's Trace stays a set of bounded files rather than one unbounded one. The rotation is invisible to readers — the shards are read in order, and the tail read above only ever needs the last one.

## Details

- New: `packages/server/src/internal/trace-tail.ts`; `trace-service.ts` reads through it.
- Tests: `server/test/trace-tail.test.ts` and `trace-tail-page.test.ts` (window boundaries, cursor and `tracePosition` preservation, page identity against the full read), `core/test/trace.test.ts` (the writer's rotation).
