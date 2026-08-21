# Usage charts rebuilt as time series with range and precision controls

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `web`, `server`, `docs`
- **PR:** [#371](https://github.com/Prism-Shadow/penguin-harness/pull/371)
- **Breaking:** yes — `GET /usage` no longer returns `trend`, `byAgent` or `success`, and the per-status failure breakdown `success` carried is gone.

[中文版](2026-08-20-usage-charts.zh.md)

Rebuilt the cost center's charts around one shared time axis. The page gained a date-range preset — trailing "last hour" and "last 24 hours" windows, calendar last 7 / 30 / 90 days (7 days is the default), or a custom pair of dates — and a time-series precision selector (per minute / hourly / daily / weekly / monthly; the offered options follow the preset, and the last hour is served by minute buckets). Every chart draws over that range at that precision:

- The share pie and the per-model progress bars were replaced by **two requests + success-rate charts**, side by side: one broken down by Agent, one by Model. In each, a bucket's requests are a bar stacked one segment per entity against the left count axis, and every entity's success rate is its own dashed line against the right-hand 0–100% axis in the same hue — dashed for the same reason the Token chart's curve is, to mark a stroke as belonging to the right axis — with the legend underneath. Both breakdowns are on screen at once — there is no dimension toggle, and neither chart opens on an aggregate total. The top four entities are named, one CVD-checked hue each, and the rest fold into a neutral series whose label carries how many it folded. A rate line stops in any bucket where its entity had no rated request rather than drawing a flat 100% across an interval it never ran in. Hovering a bucket reports every drawn entity's request count and rate plus the column total; hovering a legend item fades the other entities out.
- The Token chart kept its three-segment stacked bars and gained the cache hit rate as a dashed smooth curve drawn in front of the bars on its own right-hand 0–100% axis. The curve is continuous — a bucket with no cache traffic counts as 0, never a gap — and hovering anywhere in a column reports the whole bucket: all three Token counts plus the hit rate. Bars shrink to fit the card instead of scrolling horizontally.
- Cost stayed a straight polyline with a dot on every point (plus the area fill), over the selected range.

The hit-rate curve's smoothing is monotone cubic (Fritsch–Carlson tangents), so it never overshoots its data. Empty buckets appear as zero-filled points and display 0 rather than a dash. Charts never scroll; the only global controls above them are the range and precision selectors. The errors panel dropped its scroll box — height is bounded by pagination alone, and the server-supplied first page shrank from 20 rows to 10.

## Details

- `GET /usage` gained optional query parameters `granularity` (`minute` / `hour` / `day` / `week` / `month`, defaulting to `day`) and `fromTs`/`toTs` (ISO timestamps bounding a trailing window, given together; required for `minute`, and refining every range-scoped aggregate down to instants). The response gained `granularity`, `series` (zero-filled time buckets carrying Token sums, cost, request count, and per-bucket success counts), `byAgentSeries`, and `byModelSeries` (per-entity request and success counts aligned index-for-index with `series`; each ignores its own dimension's filter, so a chart always draws that dimension's whole breakdown). `trend`, `byAgent` and `success` were removed along with the three queries behind them, so the route no longer aggregates a fixed 30-day window, a per-Agent call count and a per-Model status breakdown that nothing displayed. Every other field was left unchanged. A range × precision combination that would materialize an oversized series is rejected with 400.
- Minute and hour buckets follow the server's local clock (the same timezone the daily aggregation key was already recorded in); week buckets key on the ISO week's Monday, month buckets on `yyyy-mm`.

## Compatibility

`GET /usage` dropped three response fields. Where each number lives now:

- `trend` — the last 30 days of Token buckets and cost, one point per day. `series` carries the same points and defaults to exactly that window when no `from`/`to` is given; it also adds `requests`, `completed` and `denominator` per point.
- `byAgent` — request counts per Agent are the sum of `byAgentSeries[].requests`. Token totals per Agent come from `?groupBy=agent`, whose `groups` rows carry `total`, `requests` and `cost`.
- `success` — a Model's successful requests and its non-aborted denominator are the sums of `byModelSeries[].completed` and `byModelSeries[].denominator`. The per-status counts (`aborted`, `failed`, `timeout`, `malformed`) have no replacement: nothing displayed them, and error diagnosis is served by the `errors` panel, which records source and code per failure.

The Web App reads none of the three, so no client change ships with this. A third-party consumer reading them from the HTTP API has to move to the fields above.
