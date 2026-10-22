# The UI package's pie, scatter and gauge charts

- **Date:** 2026-10-19
- **Type:** feature
- **Scope:** `ui`, `ui-gallery`
- **PR:** [#1235](https://github.com/Prism-Shadow/penguin-harness/pull/1235)

[中文版](2026-10-19-charts-radial.zh.md)

The shared UI package gained the rest of the basic chart set: `PieChart`, `ScatterChart` and `Gauge`. They draw through the same chart primitives and conventions as the bar and line charts, and add no theme tokens.

## Details

- `PieChart` draws one series as ring arcs clockwise from twelve o'clock, with a hairline between neighbouring slices; `donut` leaves the middle 60 % of the radius open. A list legend beside the pie gives each slice's amount and share, and pointing at a row fades the other slices. A slice of zero draws no arc but keeps its row.
- `ScatterChart` draws series of `[x, y]` points on two value axes, both carrying the caller's units. Each axis fits the data's own extent, so readings far from zero fill the plot; a given y range still wins. With more than one series there is a legend, and pointing at an item fades the other series. Points that are not finite are skipped.
- `Gauge` shows one reading against a whole as a `role="meter"`: the figure with its unit and a ring for the share. The ring takes the accent while the reading is fine and the tone's ink when a tone is passed, and a ring short of full has round caps. `lone` sets a large figure, and `ring={false}` keeps the meter without the ring.

## Gallery

- The Basic charts part of the charts board gained a scatter chart, a pie and a donut, and gauges.
