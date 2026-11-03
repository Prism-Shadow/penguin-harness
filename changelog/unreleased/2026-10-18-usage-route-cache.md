# The cost center's dashboard read is answered from a 30-second cache

- **Date:** 2026-10-18
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1193](https://github.com/Prism-Shadow/penguin-harness/pull/1193)

[中文版](2026-10-18-usage-route-cache.zh.md)

`GET /api/projects/:projectId/usage` ran its grouped scans again on every request, and the cost
center's dashboard is what asks for them — once per panel, and again on every poll of its rolling
window. Reads that would be answered the same way now share one cache entry.

## Details

- An entry is keyed by the Project and every field of the query, `includeGlobalErrors` included:
  an admin's answer, which carries the unattributed error rows, is never served to a member.
- The dashboard recomputes its rolling `fromTs`/`toTs` from the clock on every poll, so those two
  instants are folded to 30s buckets — in the key only, where the query the service runs still
  carries the exact instant the caller sent. Polls describing one window share an entry; a window
  whose bound moved past the bucket is a new one.
- The entry's lifetime is that same 30s bucket, so one bucket's aggregate runs once rather than
  once per poll, and the staleness a reader sees is the one the quantized key already accepts.
- Concurrent identical reads await the query already running instead of starting a second.
- A failed query is neither cached nor shared: its slot is cleared when it settles.
- The cache is created per route instance, so a second app in the same process — every test's app
  — never reads another's responses. Past 200 entries it is emptied rather than evicted in order.
