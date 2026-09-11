# The Trace overview shows the elapsed total, with its breakdown on hover

- **Date:** 2026-09-10
- **Type:** fix
- **Scope:** `web`
- **PR:** [#676](https://github.com/Prism-Shadow/penguin-harness/pull/676)

[中文版](2026-09-10-trace-elapsed-total.zh.md)

A Trace file's overall summary printed the elapsed total and its API / tool breakdown on the same
line, so the row carried three durations at rest. Elapsed now shows the total on its own and keeps
the breakdown in its hover text — the reading the per-round chip beside it already gave, so both
surfaces word it the same way. The hover text is the row's accessible name too, with the total kept
beside the breakdown.
