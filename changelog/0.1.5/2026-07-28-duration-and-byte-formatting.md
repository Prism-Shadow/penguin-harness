# Web App and CLI: duration and byte abbreviations carry into the next unit

- **Date:** 2026-07-28
- **Type:** fix
- **Scope:** `web`, `cli`
- **PR:** [#112](https://github.com/Prism-Shadow/penguin-harness/pull/112)

[中文版](2026-07-28-duration-and-byte-formatting.zh.md)

Two display helpers chose a unit — or split a value into minutes and seconds — from the raw input while printing a rounded one, so a duration could read `1m60s` and a file size `1024KB`. Both now round before deciding what to print.

## Durations no longer print a 60-second remainder

`humanizeDuration` floored the minutes but rounded the seconds remainder, two opposite rounding directions applied to one split. A remainder in `[59.5, 60)` therefore rounded up to 60 without the minute following it: 119.7s rendered as `1m60s` instead of `2m0s`, and 3599.7s as `59m60s`. Compact mode had the same mismatch one unit down, picking the sub-minute branch from the unrounded value and then printing `Math.round(59.6)` as `60s` rather than `1m0s`. Every whole-second form now rounds the total first and splits that integer, so the minutes and the remainder always come from the same number; sub-minute values outside compact mode keep their tenths and are unaffected. The fix lands in both copies — `packages/web/src/lib/format.ts` and the CLI's `packages/cli/src/render.ts`, whose abbreviations are deliberately identical — so the Web App and the `[stats]` line cannot drift apart. Visible wherever a settled duration is shown: benchmark evaluation, case and run timings, Trace turn durations, tool-call cards, the task statistics footer, and the agent topology view.

## Byte counts no longer print an out-of-range unit

`formatBytes` selected the unit by comparing the raw byte count against the magnitude thresholds, but rendered the value through the shared one-decimal rounding. A count just under a boundary was rounded past it after the unit had already been fixed, so 1048570 bytes printed as `1024KB` instead of `1MB`, and the MB/GB boundary behaved the same way. The unit is now chosen from the rounded value. Visible on Trace file sizes and in the workspace file browser.
