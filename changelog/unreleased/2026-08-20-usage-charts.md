# Usage charts rebuilt as time series with range and precision controls

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `web`, `server`, `docs`
- **PR:** [#371](https://github.com/Prism-Shadow/penguin-harness/pull/371)
- **Breaking:** yes — `GET /usage` no longer returns `trend`, `byAgent` or `success`, and the per-status failure breakdown `success` carried is gone.

[中文版](2026-08-20-usage-charts.zh.md)

Rebuilt the cost center's charts around one shared time axis. The page gained a date-range preset — trailing "last hour" and "last 24 hours" windows, calendar last 7 / 30 / 90 days (7 days is the default), or a custom pair of dates. The range alone decides the precision the series is drawn at — per minute for the last hour, hourly for the last 24 hours, daily for the calendar presets, and week or month for a long custom range — so there is no second control to keep in step with the first. Every chart draws over that range:

- The share pie and the per-model progress bars were replaced by **two requests + success-rate charts**, side by side: one broken down by Agent, one by Model. In each, a bucket's requests are a bar stacked one segment per entity against the left count axis, and every entity's success rate is its own dashed line against the right-hand 0–100% axis in the same hue — dashed for the same reason the Token chart's curve is, to mark a stroke as belonging to the right axis — with the legend underneath. Both breakdowns are on screen at once — there is no dimension toggle, and neither chart opens on an aggregate total. The top four entities are named, one CVD-checked hue each, and the rest fold into a neutral series whose label carries how many it folded. Three ways to single out one entity, all fading the rest: hover one of its bar segments, hover its rate line, or hover its legend item. The lines are drawn above the bars and answer the pointer above them too, so a line is never lost behind a tall segment.
- The Token chart kept its three-segment stacked bars and gained the cache hit rate as a dashed line drawn in front of the bars on its own right-hand 0–100% axis. Hovering anywhere in a column reports the whole bucket (all three Token counts plus the hit rate), hovering one segment singles it out, and hovering the line singles out the line. Bars shrink to fit the card instead of scrolling horizontally.
- Cost stayed a straight polyline with a dot on every point (plus the area fill), over the selected range.

Every line on the page is straight segments between its points, with no smoothing anywhere, and all of them are drawn at the same stroke width — no line is heavier than another because it was written later. Charts never scroll; the only global controls above them are the Agent, model and range selectors. The errors panel dropped its scroll box — height is bounded by pagination alone, and the server-supplied first page shrank from 20 rows to 10.

## Buckets with nothing in them

A rate line and a bar chart disagree about what an empty interval is, so the page answers it twice.

**A bucket with no rate is drawn, not read.** An entity that made no request in a bucket has no success rate there, and a bucket with no cache traffic has no hit rate; the line is carried across at the top of the axis so the stroke stays continuous. That is a drawing choice about a shape, and nothing more — the hover table prints a dash for the same bucket, never a percentage. A real 0% still prints 0%: requests were made and every one of them failed, which is a fact about the data rather than a hole in it.

**A bucket that recorded nothing at all is not drawn.** The Token and cost charts plot only the intervals that have values, packed left to right, whatever range is selected — the shape those two had before the range control existed, and the one that survives a long quiet stretch without turning into a flat line at zero. The requests charts keep every bucket in the range, because a bucket one entity skipped is a bucket another one worked in.

That leaves two x axes in one grid, which is stated rather than left to be discovered: each compressed axis carries a break mark at every skip, and a caption under the chart says how many intervals are missing and that this axis is not the one above it. Both compressed charts share a single compaction, so they always agree with each other.

## Details

- `GET /usage` gained optional query parameters `granularity` (`minute` / `hour` / `day` / `week` / `month`, defaulting to `day`) and `fromTs`/`toTs` (ISO timestamps bounding a trailing window, given together; required for `minute`, and refining every range-scoped aggregate down to instants). The response gained `granularity`, `series` (zero-filled time buckets carrying Token sums, cost, request count, and per-bucket success counts), `byAgentSeries`, and `byModelSeries` (per-entity request and success counts aligned index-for-index with `series`; each ignores its own dimension's filter, so a chart always draws that dimension's whole breakdown). `trend`, `byAgent` and `success` were removed along with the three queries behind them, so the route no longer aggregates a fixed 30-day window, a per-Agent call count and a per-Model status breakdown that nothing displayed. Every other field was left unchanged. A range × precision combination that would materialize an oversized series is rejected with 400.
- Minute and hour buckets follow the server's local clock (the same timezone the daily aggregation key was already recorded in); week buckets key on the ISO week's Monday, month buckets on `yyyy-mm`.

## Compatibility

`GET /usage` dropped three response fields. Where each number lives now:

- `trend` — the last 30 days of Token buckets and cost, one point per day. `series` carries the same points and defaults to exactly that window when no `from`/`to` is given; it also adds `requests`, `completed` and `denominator` per point.
- `byAgent` — request counts per Agent are the sum of `byAgentSeries[].requests`. Token totals per Agent come from `?groupBy=agent`, whose `groups` rows carry `total`, `requests` and `cost`.
- `success` — a Model's successful requests and its non-aborted denominator are the sums of `byModelSeries[].completed` and `byModelSeries[].denominator`. The per-status counts (`aborted`, `failed`, `timeout`, `malformed`) have no replacement: nothing displayed them, and error diagnosis is served by the `errors` panel, which records source and code per failure.

The Web App reads none of the three, so no client change ships with this. A third-party consumer reading them from the HTTP API has to move to the fields above.
