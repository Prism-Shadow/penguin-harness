# The costs page reads a pre-aggregated usage table instead of scanning every record

- **Date:** 2026-10-18
- **Type:** refactor
- **Scope:** `server`

[中文版](2026-10-18-usage-daily-rollup.zh.md)

The costs page stopped re-aggregating the whole `usage_records` table on every request. An
aggregation whose figures survive folding a day's records together now reads a pre-aggregated
table, and the aggregated rows behind one set of parameters are reused for a short while, so a
price edited in the meantime still shows up on the very next read.

## Details

- `usage_daily_rollup` holds `usage_records` pre-summed by `(project_id, date, agent_id,
  session_id, provider, model_id, peak)`. Every column is a sum over the same rows, and each
  group-by dimension is one of those key columns, so the same query returns identical figures
  from a few thousand rows instead of a few hundred thousand.
- A read only takes the rollup where folding changes no figure — no price tier in play, no
  timestamp window, and no named Session subset — because a tier is decided per record from its
  own `ts` and the day-grained rollup does not carry the instant. Everywhere else the query runs
  against `usage_records` unchanged.
- `requests` is the one figure folding could move: a rollup row already stands for several
  requests, so every rollup read sums the stored count rather than counting folded rows.
- The rollup is a rebuildable cache with no data of its own: a write folds into it as it lands
  (an UPSERT), and the first read after the table is found empty rebuilds it from
  `usage_records`, which is also its whole recovery path.
- `UsageService` keeps the aggregated rows — not the finished response — for 15 seconds, keyed
  by the Project and every parameter that selects rows. Pricing runs on every read, so a rate
  added or edited applies at once; `UsageRecorder` drops the Project's cached rows as soon as
  usage lands, so a figure already on screen is not held past the tokens behind it.
- `UsageQuery.groupLimit` caps a grouped response to the most recent groups, for the dimensions
  whose key carries an order (`date`, `agent`, `session`). The route refuses it for `model`,
  whose key has no order the server could vouch for, rather than return an arbitrary subset the
  caller would present as the most recent ones.
- Added the `idx_usage_project_ts` index: the today and last-7-days ranges filter on `ts`, while
  the existing `(project_id, date)` index covers a different column.
