# Skill cards and the error table stay inside a phone-width viewport

- **Date:** 2026-08-23
- **Type:** fix
- **Scope:** `web`
- **PR:** [#430](https://github.com/Prism-Shadow/penguin-harness/pull/430)

[中文版](2026-08-23-phone-width-overflow.zh.md)

Two surfaces in the Web App laid themselves out wider than the screen at phone width, and each one
put something out of the reader's reach. Both now stay inside the viewport.

## Skill library

- A skill card's action buttons — quick invoke, manage installs, update installs — were carried
  past the right edge of the screen and clipped away by the group section, leaving no way to tap
  any of them. The card grid now declares its single-column track below the `sm` breakpoint rather
  than leaving it implicit, so a card is no longer widened to fit the longest description it
  carries untruncated.

## Cost center

- The recent-errors table squeezed its message column down to zero width and pushed the other
  three columns past the right edge, taking the whole page into a sideways scroll. The table now
  states the minimum width its four columns need and scrolls horizontally inside its own box,
  leaving the page itself unscrolled.

## The same pattern elsewhere

- Two more grids declared responsive column counts with no base track: the Models page's model
  cards and the Benchmark case browser's sidebar/detail split. Both now state the single-column
  track below their breakpoint, so neither can be widened by a child's untruncatable content the
  way the skill cards were. An audit of every `grid-cols-` site in the Web App found no others.

