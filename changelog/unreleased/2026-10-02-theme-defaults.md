# Frost is the default theme, Primer returns to its 0.2.13 look, and every theme's own accent is black and white

- **Date:** 2026-10-02
- **Type:** feature
- **Scope:** `ui`, `web`, `ui-gallery`

[中文版](2026-10-02-theme-defaults.zh.md)

A round of theme adjustments from the owner's review of the three themes against release 0.2.13.

## Changes

- **Default theme:** a browser that has never chosen a theme now opens in Frost. A theme chosen in Settings, Primer included, is kept.
- **Order and names:** the theme picker and the gallery list Frost, Console, Primer. Primer's Chinese name is 朴素 (it was 通用).
- **Primer back to 0.2.13:**
  - Its light grays return to Tailwind's stock scale; the neutral scale of 2026-09-30 was withdrawn.
  - Its own accent returns to the near-black `#111827` and the near-white `#f3f4f6`.
  - Its fonts return to the platform's system faces for Latin and Chinese. JetBrains Mono stays for code, and Mona Sans stays bundled as a font-pairing option.
  - Its icons are the line drawings again; the Octicons of 2026-10-01 were withdrawn.
  - The dark-mode contrast adjustment of 2026-09-29 stays.
- **Accent:** every theme's own accent ("Theme's own") is now black in light and white in dark. Frost's forest green became the preset `forest`, first in its list. A stored preset is unchanged.
- **Settings dialog:** wider on desktop (56rem, from 48rem) in every theme.
- **Settings avatar:** the profile page's avatar is 40px (it was 64px).
- **Tags:** badges and counts, the model marks (Free, Vision, Fast, Discount) among them, are set one step under each theme's small text size, through two new badge tokens.
- **Full access:** the composer's permission shield reads amber for full access, like partial access, and the two are told apart by their glyphs. It is no longer red.
