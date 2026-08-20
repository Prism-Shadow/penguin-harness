# Usage charts as smooth time series with range and precision controls

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `web`, `server`, `docs`

[中文版](2026-08-20-usage-charts.zh.md)

Rebuilt the cost center's charts around one shared time axis. The page gained a date-range preset (last 7 / 30 / 90 days, or a custom pair of dates) and a time-series precision selector (hourly / daily / weekly / monthly — the offered options follow the range), and every chart now draws over that range at that precision:

- Calls per Agent became smooth lines, one color per Agent (top Agents keep their own CVD-checked hue, the tail folds into a neutral "other"), replacing the share pie.
- Success rate became a single smooth line on a fixed 0–100% scale, replacing the per-model progress bars.
- The Token chart kept its three-segment stacked bars and gained the cache hit rate as a smooth curve drawn in front of the bars on its own right-hand 0–100% axis; bars now shrink to fit the card instead of scrolling horizontally.
- Cost became a smooth line + area.

Smoothing is monotone cubic (Fritsch–Carlson tangents), so a curve never overshoots its data — a 100% success rate cannot arc above 100%, and an idle bucket still appears as a zero-filled point instead of the line silently bridging the gap. Charts never scroll; the only controls above them are the range and precision selectors. The errors panel dropped its scroll box — height is bounded by pagination alone, and the server-supplied first page shrank from 20 rows to 10.

## Details

- `GET /usage` gained an optional `granularity` query parameter (`hour` / `day` / `week` / `month`, defaulting to `day`), and its response gained `granularity`, `series` (zero-filled time buckets carrying Token sums, cost, request count, and per-bucket success counts), and `byAgentSeries` (per-Agent request series aligned index-for-index with `series`). Existing fields were left unchanged. A range × precision combination that would materialize an oversized series is rejected with 400.
- Hour buckets follow the server's local clock (the same timezone the daily aggregation key was already recorded in); week buckets key on the ISO week's Monday, month buckets on `yyyy-mm`.
