# Start page: the version line sits under the slogan at every width

- **Date:** 2026-10-13
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1102](https://github.com/Prism-Shadow/penguin-harness/pull/1102)

[中文版](2026-10-13-start-version-line.zh.md)

The start page's version line (`v0.2.15 · Last updated Oct 13`, with the update hint when a newer
release waits) has one place at every window width: under the slogan, starting at the name's left
edge.

## Details

- The logo matches the combined height of the product name, slogan and version line. Its size
  is capped on narrow screens so wrapped text keeps enough room beside it.
- Beside the counts, the line runs on under them, so it stays on one line with the update hint.
  It used to sit beside the name at some widths and under it at others, and could break after
  "Last updated" or leave the hint alone on a line.
- Where a phone column cannot hold the whole line, it wraps only between phrases: the update hint
  moves down whole first, then the date. The App info dialog's version line wraps the same way.
- On a phone at the largest text size, the product name breaks between "Penguin" and "Harness"
  instead of pushing the page sideways.
