# A2UI chart and resources blocks, and the data widgets rebuilt on the basic charts

- **Date:** 2026-10-19
- **Type:** feature
- **Scope:** `ui`, `web`, `ui-gallery`
- **PR:** [#1238](https://github.com/Prism-Shadow/penguin-harness/pull/1238)

[中文版](2026-10-19-a2ui-chart-blocks.zh.md)

A reply draws `chart` and `resources` blocks, and the metrics and weather widgets were rebuilt on the same basic charts, so a lone chart, the chart block and the composite widgets share one drawing.

## Rendering

- The chart block draws each kind through a basic chart: line and area through `LineChart`; bar through `BarChart`, or `HBarChart` when horizontal, where a stacked chart is one row per category followed by its total; histogram as flush bars with bins labelled such as "0–10 ms"; pie through `PieChart`; scatter through `ScatterChart`; and gauge as a lone metrics tile. Series take the chart colours in order, values print with their units and decimals, and the chart is named for assistive technology by a summary of its data.
- The resources block draws a metrics tile per reading (CPU, memory, swap, load, uptime) in the fixed thresholds' tones, the disks as horizontal bars on a 0–100 % scale, and the network as a line of the received and sent rates, captioned with the number of readings.
- The metrics tile draws every reading out of a whole through `Gauge` and looks as before. The weather card's next hours are a bare `LineChart`, and its coming days are `HBarChart` range rows, 6 px thick instead of 4 px, in the theme's bar style.
- A list inside a widget no longer takes the reply's list indent.
- The UI strings and the Web App's dictionaries gained the words of the chart summary and the resources block in zh and en.

## Gallery

- The A2UI reply board shows a bar chart and a resources board, and its metrics sample became an API quota, a budget, test runs with a history and a latency.
