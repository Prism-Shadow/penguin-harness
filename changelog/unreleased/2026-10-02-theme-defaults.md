# Frost became the default theme, Primer returned to its 0.2.13 look, and every theme's own accent went black and white

- **Date:** 2026-10-02
- **Type:** feature
- **Scope:** `ui`, `web`, `ui-gallery`
- **PR:** [#951](https://github.com/Prism-Shadow/penguin-harness/pull/951)

[中文版](2026-10-02-theme-defaults.zh.md)

A round of theme adjustments followed the owner's review of the three themes against release 0.2.13.

## Changes

- **Default theme:** a browser that had never chosen a theme started opening in Frost. A theme chosen in Settings, Primer included, was kept.
- **Order and names:** the theme picker and the gallery listed Frost, Console, Primer. Primer's Chinese name became 朴素 (it was 通用).
- **Primer back to 0.2.13:**
  - Its light grays went back to Tailwind's stock scale; the neutral scale of 2026-09-30 was withdrawn.
  - Its own accent went back to the near-black `#111827` and the near-white `#f3f4f6`.
  - Its fonts went back to the platform's system faces for Latin and Chinese. JetBrains Mono stayed for code, and Mona Sans stayed bundled as a font-pairing option.
  - Its icons went back to the line drawings; the Octicons of 2026-10-01 were withdrawn.
  - The dark-mode contrast adjustment of 2026-09-29 was kept.
- **Accent:** every theme's own accent ("Theme's own") became black in light and white in dark. Frost's forest green became the preset `forest`, first in its list. A stored preset was left unchanged.
  - Frost's running highlight, the band that sweeps across a working step's label, became the accent mixed toward the page, so it stood out from the text whatever the accent. With the own accent equal to the text colour, the band would otherwise have vanished.
- **Settings dialog:** it grew wider on desktop (56rem, from 48rem) in every theme.
- **Settings avatar:** the profile page's avatar shrank to 40px (it was 64px).
- **Tags:** badges and counts, the model marks (Free, Vision, Fast, Discount) among them, were set one step under each theme's small text size, through two new badge tokens.
- **Full access:** the composer's permission shield turned amber for full access, like partial access, and the two were told apart by their glyphs. It was no longer red.
