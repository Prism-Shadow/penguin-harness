# The company surface's JSON answers packed

- **Date:** 2026-10-21
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1285](https://github.com/Prism-Shadow/penguin-harness/pull/1285)

[中文版](2026-10-21-org-json-packed.zh.md)

A JSON answer that the caller says it accepts packed comes back packed — zstd when the caller takes it and this Node has it, gzip otherwise: GET answers of 200 with a JSON content type, at least two kilobytes of them, from any route group — the plugin pages' lists included. On the company list that started this, gzip bottoms out a good way above what the surface wants to carry; zstd's top level is what crosses under it. What streams is untouched (an SSE feed, a download), and the machine proxy at `/server/…` relays the machine's own answer unchanged: the machine that owns the route decides the encoding, and a browser's `Accept-Encoding` reaches it as it is. The compression runs in the thread pool, not on the event loop.
