# A leaderboard's run time and token counts carry into the next unit

- **Date:** 2026-11-03
- **Type:** fix
- **Scope:** `landing`
- **PR:** [#1449](https://github.com/Prism-Shadow/penguin-harness/pull/1449)

[中文版](2026-11-03-leaderboard-run-figures-carry.zh.md)

A Leaderboard page no longer shows a run's time or token count in a unit the rounded figure has outgrown. The time picked minutes from the raw value and then rounded, so a run of 59.6 minutes read `60 min`. Token counts did the same, so 999,500 read `1000K` and 99,960 read `100.0K`. They now read `1.0 h`, `1.0M` and `100K`. `formatDuration` moved from `score-table.tsx` to `src/lib/hub/text.ts` beside the other hub formats.
