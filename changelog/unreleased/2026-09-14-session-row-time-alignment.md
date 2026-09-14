# The session row's marks line up, and a Chinese date reads 8月30日

- **Date:** 2026-09-14
- **Type:** fix
- **Scope:** `web`
- **PR:** [#717](https://github.com/Prism-Shadow/penguin-harness/pull/717)

[中文版](2026-09-14-session-row-time-alignment.zh.md)

The marks right of a session title — the run glyph, the background-task and schedule marks, the approval count — drifted from row to row because the trailing time slot's width followed the time string. The slot now takes a fixed width per interface language, so the marks form one vertical column, and the Chinese month-day is written without spaces.

## Details

- The slot is 4.5rem in Chinese (room for 「12月31日」 and 「59 分钟前」) and 3rem in English (room for "Dec 31"), never narrower than the hover pair of archive and delete buttons it swaps with; the time is right-aligned in tabular figures.
- `formatMonthDay` writes `8月30日` in Chinese and keeps `Aug 30` in English. It also formats a one-off schedule's date on the scheduled-tasks rows and the version line's "last updated" date, which change the same way.
