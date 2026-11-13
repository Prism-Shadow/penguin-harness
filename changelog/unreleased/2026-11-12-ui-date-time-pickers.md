# Date and time pickers after iOS's, in the shared UI package

- **Date:** 2026-11-12
- **Type:** feature
- **Scope:** `ui`, `ui-gallery`, `web`
- **PR:** [#1547](https://github.com/Prism-Shadow/penguin-harness/pull/1547)

[中文版](2026-11-12-ui-date-time-pickers.zh.md)

The shared UI package (`@prismshadow/penguin-ui`) gained four picker fields modelled on iOS's calendar and wheels — `DateField`, `TimeField`, `DateTimeField` and `DateRangeField` — that write the native inputs' formats (`YYYY-MM-DD`, `HH:mm`, `YYYY-MM-DDTHH:mm`, local and without a zone), so a caller swaps a native input for one without changing what it stores. The gallery's inputs board shows them in place of the native inputs.

## Details

- **The field** sits on the shared control look, the same height and focus ring as an Input or a Select of its rung, and shows the value the way the reader's locale writes it: 2026年11月12日 / Nov 12, 2026, 14:30 / 2:30 PM, a span as 2026年11月1日至12日 / Nov 1 – 12, 2026. An empty field shows a placeholder; an optional field holding a value shows a clear cross in place of its calendar or clock mark; a required, refused or closed field reads as the other fields do. With a `name` the value is also posted in a hidden input.
- **The calendar** opens in a popover under the field (above it when there is no room, a full-width sheet along the bottom edge under 640px), portaled over dialogs and transcripts: a month with its weekdays in the locale's order (Monday first for zh-CN, Sunday for en-US), six weeks so it never changes height, the picked day as an accent disc, today in the accent's ink inside a hairline ring, days outside `min` / `max` faded and not pickable, the ‹ › month steps and Today. Pressing the month title swaps the grid for month and year wheels. A new month arrives under the theme's reveal.
- **The wheels** for hours, minutes and, on a 12-hour clock, the day period scroll with snapping, follow the mouse wheel and a mouse drag, and settle on the row under their band; a minute step (1, 5, 15) sets the minute rows. The date-and-time field puts a time row under its calendar whose pill swaps in the wheels; the range field takes two presses in either order, shades the days between them on a flat band, and offers its caller's presets as chips.
- **Keyboard and assistive technology**: the field is a button named by its title and value that opens a labelled dialog; the grid follows the ARIA date-grid pattern (arrows, Home / End, Page Up / Page Down, with Shift a year, Enter); each wheel is a spin button (↑ / ↓, Page Up / Page Down, Home / End, typed digits or letters); Escape closes the popover and leaves a dialog around the field open, and the focus returns to the field.
- Dates are reckoned on the calendar day itself, never through the reader's zone, so no day shifts west of Greenwich or across a daylight-saving change. Words and the locale come from a new `dates` group of `UiStrings`, which the Web App fills from both dictionaries.
