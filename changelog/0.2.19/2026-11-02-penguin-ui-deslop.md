# The shared UI package and the landing shed their AI-slop tells

- **Date:** 2026-11-02
- **Type:** fix
- **Scope:** `ui`, `landing`, `web`, `docs`, `skills`
- **PR:** [#1423](https://github.com/Prism-Shadow/penguin-harness/pull/1423)

[中文版](2026-11-02-penguin-ui-deslop.zh.md)

The public sites' shared components and the landing's existing pages were cleaned against the owner's AI-slop checklist, the de-slop guard learned the tells it can check mechanically, and the landing's first chunk got lighter.

## Shared UI package

- The docs sidebar's section labels and the table of contents' heading are sentence case, without letter-spacing, and no longer carry the app's eyebrow hook, so the gallery's themes cannot restyle them.
- The site pill and the search dialog's key hint went from 11px and 10px to 12px. A filled pill keeps its tint and drops the border of the same hue.
- The language menu's trigger lost its caret. The GitHub link's name reads "GitHub, 3,111 stars".
- `SiteCodeCard` moved into a module of its own (`site-code-card.tsx`, still exported from `@prismshadow/penguin-ui/site`), so a page with a command card no longer carries the article code block and its grammar table in its first chunk.
- The values `tokens.ts` computes when it loads are marked pure, so a bundle that never reads them drops them.

## De-slop guard

- Rule 8 catches a coloured left border at any width, including the brand scale and `border-left` in a stylesheet.
- Rule 14 catches a positive literal tracking and a positive `letter-spacing`, and a public-site rule no longer passes as the app's eyebrow hook.
- New rule 23: no text below 12px, as a class, a stylesheet `font-size` or an SVG `fontSize`. The chart marks' 9 and 11 px labels are allowlisted.
- New rule 24: no middle dot between items, in a dictionary or as a lone text child. The Web App's existing ones are allowlisted for W10.
- `packages/landing/test/deslop.test.ts` runs rules 2, 8, 13, 14, 21, 23 and 24 over the landing.

## Landing

- Sections no longer fade and slide in as the page scrolls. The ambient backdrop moves by `transform` only.
- No text is below 12px, and literal sizes such as `text-[13px]` or `text-[1.7rem]` became the scale's sizes. The AMSP page's headline is one size smaller, and its name no longer colours each initial.
- The download page lost its "Download" eyebrow over "Download desktop", and the quick start's step labels are no longer uppercase brand-coloured labels.
- Middle dots between items became space or sentence punctuation: the platform list, the benchmark footnotes, the footer copyright (also on the docs and in the gallery), post dates and categories, and the AMSP page's readouts.
- The benchmark charts start their bars at zero, name each bar by its logo (the table under them names every row), and lay out at the width they are shown at. The self-evolution trend charts do the same.
- The two demo videos are captioned with what their runs cost, in the muted ink. The captions that narrated the videos, and the note under the trend charts, were removed. The A2APP request is set in the page's own face.
- Arrows no longer nudge on hover, the browser frame lost its three window dots, the closing call to action lost its border, the AMSP records list lost its coloured edge bar, and dark cards on the home page are solid.
