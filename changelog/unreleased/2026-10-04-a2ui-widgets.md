# A2UI widgets: weather, clock, countdown and metrics, and the block redesign

- **Date:** 2026-10-04
- **Type:** feature
- **Scope:** `core`, `ui`, `web`, `skills`
- **PR:** [#983](https://github.com/Prism-Shadow/penguin-harness/pull/983)

[中文版](2026-10-04-a2ui-widgets.zh.md)

The A2UI catalog ([2026-10-03-a2ui-blocks.md](2026-10-03-a2ui-blocks.md)) gained four glanceable
widgets — `weather`, `clock`, `countdown` and `metrics` — and the existing choice, form, steps,
callout and Mermaid blocks were redrawn as one family. Weather and metrics are snapshots the model
supplies together with the time it read them; the clock and the countdown run on the viewer's own
clock. Two new skill scripts print real weather and system data as ready-made blocks.

## Changes

- **Catalog:** `weather` (the conditions at a place, eleven conditions, optional next hours and
  coming days, an animated line illustration), `clock` (one to four IANA time zones or the local
  one, digital, analog or both, ticking every second), `countdown` (the time left until an ISO
  date-time, with a label for when it is reached) and `metrics` (one to eight tiles in one block).
  A metrics tile is a `reading`, a `used` or `remaining` share of a whole, or a job's `progress`;
  it draws a ring or bar gauge, a sparkline of its history and its change, and its `warn` and
  `danger` thresholds, read along `worse`, colour it. The one component covers system resources,
  progress bars and remaining quota or budget.
- **Snapshots carry their time:** weather and metrics took an `asOf` date-time, shown in the
  widget's head. The checker warns with `no_as_of` when it is missing, and the self-review rubric
  gained an eighth question: is every number in a widget real, with its time. New L1 codes:
  `invalid_datetime`, `invalid_timezone`, `duplicate_zone`; new L2 warnings: `no_as_of`,
  `weather_hourly_long`, `metrics_too_many`. Widgets are not questions, so prose may follow them.
- **Widget surface:** the four widgets share `WidgetSurface` and a new `ui-widget` style hook.
  Frost draws them as a soft filled tile with white inner tiles, Console as a hairline box with
  monospaced figures, and Primer keeps the card. Core's `a2ui` module gained the formatting
  helpers the renderers and the text fallback share: numbers, temperatures, the time left and a
  metric's tone.
- **Motion:** each weather illustration loops to show its condition (rain falls, snow drifts,
  clouds drift, lightning flashes) and the hourly temperature line draws in once. The loops take
  the theme's live timing, stand still under reduced motion, and pause while the widget is
  scrolled out of view, where the clock stops ticking too.
- **Redesign:** a short choice became a row of chips and a longer one a column of cards with a
  radio-style disc; a short single-select form field became a segmented control, a short
  multi-select a row of toggle chips, and a number field gained −/+ buttons clamped to its
  bounds; steps became a numbered timeline; the Mermaid box took the surface fill. Every block
  arrives with the theme's reveal once the reply settles.
- **Plain text everywhere else:** the CLI and the messaging channels show each widget as text —
  weather as a headline over its details, hours and days; a clock as one line per zone; a
  countdown as the time left; metrics as one bullet per tile with a warning, critical or done
  mark — with weather and metrics ending on their `asOf` time.
- **Scripts:** the skill ships `scripts/weather.mjs`, which reads Open-Meteo (no key, Chinese
  place names accepted) and prints a `weather` block, and `scripts/sysinfo.mjs`, which reads CPU,
  memory, disk, load and uptime through Node's `os` and `fs` modules and prints a `metrics`
  block. Both are hand-written and dependency-free, run on Windows, macOS and Linux, and print a
  fence to paste as is, or the bare JSON with `--json`. The skill tells the model to use them
  instead of numbers from memory.
- **Skill and docs:** the a2ui skill and its component reference covered the four widgets with
  examples, and the plugin moved to `2026.10.09.1`. The chat page's "Rich output blocks" section
  listed the widgets, and the UI gallery's content board gained samples of them.
