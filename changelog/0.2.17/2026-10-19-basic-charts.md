# The UI package's bar, horizontal bar and line charts

- **Date:** 2026-10-19
- **Type:** feature
- **Scope:** `ui`, `ui-gallery`
- **PR:** [#1232](https://github.com/Prism-Shadow/penguin-harness/pull/1232)

[中文版](2026-10-19-basic-charts.zh.md)

The shared UI package gained basic charts drawn from the caller's categories and series, with units on the axes: `BarChart`, `HBarChart` and `LineChart`. They draw through `ChartFrame` and the existing chart primitives, so each theme's chart style applies, and they add no theme tokens.

## Details

- `BarChart` draws grouped bars, stacked bars, or flush bins for a histogram, with zero always on the value axis. Pointing at a column fades the other columns and opens a bubble with every series' value; a missing reading shows "—".
- `HBarChart` draws rows on one shared scale: a value from the start, a range from low to high, or a stack of several series end to end from zero. Joined segments meet square, a row with a tone takes that tone's ink, and a stack's segment opens a bubble with its row, series and value.
- `LineChart` draws lines that break at a missing reading, an area, or stacked areas. Its bare frame has no grid or value axis and prints the values over the points. An optional draw-in traces the line; it stops under reduced motion and while the chart is scrolled off screen.
- The value axis runs from zero to a round bound in 3–6 steps of 1, 2 or 5 × 10ⁿ, and can instead fit round numbers around the readings alone. Tick labels never repeat, category labels thin out by their measured width, and a plot whose categories have no names prints no category axis. A legend appears with more than one series, and pointing at an item fades the other series. Axis names sit in rows around the plot.
- The chart primitives gained flush bars, area bands that fill down to the band below, point labels and horizontal bars with square joined ends. `ChartFrame` takes an accessible label and reads its height and paddings from the chart's geometry.
- A source guard holds every A2UI block built from charts to drawing through a basic chart, with no SVG, paint or geometry of its own.

## Gallery

- The charts board has a Basic charts part: grouped and stacked bars, a histogram, horizontal bars by value, by range and stacked, a line with a gap, a stacked area and a bare line.
