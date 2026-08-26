# Phone-width surfaces stay inside the box they are given

- **Date:** 2026-08-23
- **Type:** fix
- **Scope:** `web`
- **PR:** [#430](https://github.com/Prism-Shadow/penguin-harness/pull/430)

[中文版](2026-08-23-phone-width-overflow.zh.md)

Four surfaces in the Web App laid themselves out wider than the box they were given at phone width,
and each one put something out of the reader's reach — off the screen, past a card's edge, or
underneath the control next to it. All four now stay inside their box.

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

## Agent list

- An Agent card's stats line — sessions, tools, skills, memories, vault keys, schedules, last
  modified — ran past the card's padding at phone width and carried its last item onto the card's
  edge. The line now wraps onto a second line instead. Where it already fits on one line, nothing
  moves.

## Agent memory settings

- A memory group's header pushed its own title and item count out of the collapse button and
  painted them on top of the export and import actions sitting beside it. The title now truncates
  inside its button rather than escaping it, and on a row narrower than 28rem the three group
  actions keep their icons and drop their text labels — the models page's group-header convention,
  which this header already followed in every other respect. No action is hidden at any width;
  each one carries its name in a tooltip and an accessible label.

## The same pattern elsewhere

- Two more grids declared responsive column counts with no base track: the Models page's model
  cards and the Benchmark case browser's sidebar/detail split. Both now state the single-column
  track below their breakpoint, so neither can be widened by a child's untruncatable content the
  way the skill cards were. An audit of every `grid-cols-` site in the Web App found no others.

