# `session ls` dates an older row by the local calendar

- **Date:** 2026-10-30
- **Type:** fix
- **Scope:** `cli`
- **PR:** [#1409](https://github.com/Prism-Shadow/penguin-harness/pull/1409)

[中文版](2026-10-30-cli-ls-local-date.zh.md)

The LAST column of `penguin session ls` showed a row older than two weeks as its UTC date, while `--days` counted local calendar days. A Session last active between midnight and 08:00 in UTC+8 read as the day before, which could fall outside the window `--days` had just matched it to. The column now names the reader's own calendar day, as the Web App's session list already did.

## Details

- `relativeTime` in `packages/cli/src/table.ts` formatted the date from the local year, month and day instead of the timestamp's UTC date part. The short forms (`now`, `5m`, `3h`, `2d`) were unchanged.
