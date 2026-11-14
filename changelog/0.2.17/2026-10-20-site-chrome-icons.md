# The landing page and the docs stopped shipping the app's icon sets

- **Date:** 2026-10-20
- **Type:** fix
- **Scope:** `ui`, `landing`, `docs`
- **PR:** [#1226](https://github.com/Prism-Shadow/penguin-harness/pull/1226)

[中文版](2026-10-20-site-chrome-icons.zh.md)

The public sites' language menu drew its check with the Web App's menu mark, which is drawn in every theme's icon set, so the entry chunk of the landing page and of the docs carried the Octicons, pixel and duotone sets although the site chrome only ever shows the line drawing. The menu now draws a line-only check of the same shape and colour, and the sets left both entry chunks. The chrome renders the same pixels: screenshots of the header, the language menu and the phone menu, light and dark, at 1280 and 390 px, were byte-identical before and after.

## Details

- **`MenuRow`.** The menu row with both marks drawn by its caller; `MenuItem` is this row with a registry glyph and the menu check. `ChoiceSlot` is `ChoiceCheck`'s fixed slot around a mark the caller draws.
- **`CheckLineIcon`.** The menu check's line drawing alone, sharing its stroke with `CheckIcon`.
- **`SiteLanguageMenu`.** Its rows are `MenuRow`s with `CheckLineIcon`, and `site.css` colours the check through its own class, `site-ui-language-check`. The Web App and the gallery kept `MenuItem` and the full sets.
- **Sizes.** Entry chunk, gzip level 6 (brotli quality 11 in brackets), from `vite build` of `origin/main` at `172c9e4c4` and of this change, measured on 2026-10-19: landing 507.5 → 473.6 KiB (402.0 → 374.5 KiB), docs 930.9 → 896.9 KiB (685.5 → 658.0 KiB).
