# A2UI grammar: a chart type with seven kinds, and a system-resource board

- **Date:** 2026-10-19
- **Type:** feature
- **Scope:** `core`, `skills`
- **PR:** [#1225](https://github.com/Prism-Shadow/penguin-harness/pull/1225)

[中文版](2026-10-19-a2ui-chart-grammar.zh.md)

The A2UI grammar gained two block types: `chart`, a basic chart drawn from data, and `resources`, one machine's system snapshot. The parser, the checker and the text fallback read both, and the `a2ui` skill's bundled `check.mjs` was rebuilt from them.

## Catalog

- `chart` with `kind` `line`, `area` (optionally stacked), `bar` (grouped, stacked or horizontal), `pie` (optionally a donut), `scatter`, `histogram` and `gauge`. All kinds share one data model: categories × 1–6 series, units on the axes (`xUnit`, `yUnit`), axis names, an optional value range and decimals. A histogram has bin edges in place of categories, and a scatter has `[x, y]` points in place of values. A gauge's `item` is one metrics item, read and printed exactly as in a `metrics` block.
- `resources`: one machine's CPU with its history and cores, memory with its history, swap, 1–6 disks, the network's receive and send rates, the load averages and the uptime, with at least one section. Its tones come from fixed thresholds, not from the model: CPU, memory and swap at 80 % and 95 %, a disk at 85 % and 95 %, the load at one and two per core.
- New checker codes: `length_mismatch` (error); `chart_many_series`, `chart_many_categories`, `pie_many_slices` and `scatter_many_points` (warnings). A field the kind does not read is an `ignored_field` warning and is dropped. `no_as_of` also covers `resources`; a chart need not be a snapshot.
- As text (CLI, messaging channels), a chart prints a bullet per category or bin up to 20, and one summary line per series past that. A pie prints each slice's share, a scatter each series' extents and a gauge its metrics line. A resources board prints one bullet per reading.
- The rubric's questions on choosing a block and on numbers cover charts.
- `metrics`, `weather`, `clock` and `countdown` keep every field.
