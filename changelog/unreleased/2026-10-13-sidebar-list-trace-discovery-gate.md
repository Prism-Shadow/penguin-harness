# The sidebar list stops walking the whole Trace tree for Sessions that never ran

- **Date:** 2026-10-13
- **Type:** fix
- **Scope:** `server`

[中文版](2026-10-13-sidebar-list-trace-discovery-gate.zh.md)

Discovery asks one question per row: has this Session written Trace files the index has not stamped yet? The answer used to come from a reconciled walk of the Agent's whole Trace tree, run inline on the request path — and the gate that decided whether to run it was open on every list request of a real install.

## Why the gate stayed open

Two conditions were tried, and neither can settle on a host that has been used for a while:

- **"the row is missing from the in-process origins registry"** is true for every Session created before the process started — the whole sidebar, forever — so every list request paid the reconcile.
- **"the row still has `has_trace = 0`"** is kept true forever by Sessions created in the UI but never sent: there is nothing on disk for discovery to find and stamp, so the flag never flips. On the install this was measured on, 79 of 4117 rows.

And the pass was not a cheap walk. The Trace index's mtime gate cannot settle while the tree is being written to — the newest date directory is always fresher than the freshness window, so its cached mtime never matches — which turns `reconcileAgent` into a full re-diff of every date directory: thousands of shards, each upserted in AUTOCOMMIT against a WAL database with `synchronous = FULL`, one fsync per row (measured on that host: 579 ms per 100 upserts in AUTOCOMMIT against 4 ms inside a transaction). Seconds of synchronous work per sidebar load, on the event loop the server answers every route on — a plain list load surfaced as a **125 s `sessions/batch`**.

## What answers it now

- **One read-only sweep.** Shard files are named `<sessionId>_<NNN>.jsonl` inside a `yyyy-mm-dd` directory, so listing the date directories answers every row in the request at once — no stat, no upsert, no fsync. Concurrent callers asking about the same Agent share one sweep.
- **Sessions with nothing on disk are remembered**, up to a bounded memo, so they are not probed again; a Session that later grows a Trace is stamped by the write-time path, which is why re-probing is not needed to notice one.
- **The authoritative reconcile still runs once per newly discovered Session** — the code path that registers shards and head-reads their facts (origin, workspace, title, model reference) is what `sourceOf` needs to classify the row, so discovery hands the Sessions it did find over to it rather than classifying them itself.

## Details

- `SessionService.probeSessionsOnDisk` / `doProbeSessionsOnDisk`, `tracelessMemo` and `probesInFlight` are new; `walkRows` asks them instead of `discoverTraces`, and publishes the stamped view so a caller reading `traces` stays authoritative for that response.
- `packages/server/test/session-list-gate.test.ts` pins both halves: one sweep stamps the Session whose shard is on disk and hands it to the reconcile, the second request reads no directory at all, and an Agent whose trace tree does not exist yet answers without failing.
