# The Trace summary reports average tool calls per round instead of compactions

- **Date:** 2026-09-11
- **Type:** feature
- **Scope:** `web`
- **PR:** [#681](https://github.com/Prism-Shadow/penguin-harness/pull/681)

[中文版](2026-09-11-trace-avg-tool-calls.zh.md)

The Trace view's global summary swapped its compaction count for the average number of tool calls
per round. The average divides the two figures printed directly above it, tool calls ÷ rounds, so
it can be checked by eye and keeps the column's scope: rounds means every card below, compaction
rounds included. A Trace with no rounds leaves the average undefined and shows `—`, the mark the
cost and TPS stats already use for an unavailable figure.

The change is confined to the Web App: the Trace analysis the server returns kept its
`compactionCount` field, which simply stopped being rendered.
