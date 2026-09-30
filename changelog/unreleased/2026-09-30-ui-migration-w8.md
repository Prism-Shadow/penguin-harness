# The charts and the command palette move into the shared UI package

- **Date:** 2026-09-30
- **Type:** refactor
- **Scope:** `ui`, `web`, `ui-gallery`

[中文版](2026-09-30-ui-migration-w8.zh.md)

W8 of the UI-package migration moves the chart foundation and the command palette into `@prismshadow/penguin-ui`. The charts that draw app data stay in the Web App and draw through the package's primitives.

## What moved

- **Chart primitives:** the marks (`ChartBar`, `ChartLine`, `ChartArea`, `ChartPoint`, `ChartArc`, grid and axis, `TimelineBar`) with their geometry, `useChartStyle`, `ChartFrame` with its hover helpers, and `TokenDonut` (its words now come in a `labels` prop).
- **New:** `Sparkline` (the agent activity and benchmark score curves), `Ring` (a gauge of arcs against a budget, now drawing the finance gauge, the spend ring and the context ring), and `Legend` (inline or as a list, with hover, pin and toggle).
- **Command palette:** `CommandPalette` is the presentation; the Web App keeps the actions and the Ctrl/Cmd+P shortcut in `AppPalette`.

## Details

- The Web App's own charts (cost, token and request charts, the score trend, the Trace timeline, the finance card) now use `Legend` and the text rungs.
- The Trace timeline's open bars hold still and end in a pulsing live dot, instead of pulsing the whole bar.
- The Costs & usage page and the benchmark detail page take the shared page header; on the benchmark detail page the Benchmark's path moves to its own line under the title.
- The gallery's charts board shows `Ring` and `Legend`; the dialogs board opens the command palette.

## Visible changes in the default theme (Primer)

- Chart text of 10–11 px (legends, timeline labels, the finance card) becomes 12 px; legend gaps tighten from 16 to 12 px.
- A few tone inks in light mode are one step darker (the finance arc, the donut's near-limit remainder, the activity sparkline).
- The context panel has slightly more padding, lighter legend labels and the theme's focus outline.
- In the command palette, the selected row is a lighter fill and unselected rows are darker ink.
