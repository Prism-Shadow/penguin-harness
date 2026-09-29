# The shared UI package bundles its fonts and defines the Frost and Console themes

- **Date:** 2026-09-16
- **Type:** feature
- **Scope:** `ui`, `web`
- **PR:** [#761](https://github.com/Prism-Shadow/penguin-harness/pull/761)

[中文版](2026-09-16-theme-fonts-frost-console.zh.md)

`@prismshadow/penguin-ui` gained the fonts of all three themes, the token values of its two new
themes, Frost (`modern`, after sierra.ai) and Console (`geek`, after e2b.dev), and the closed list of
style hooks the themes give recipes to. Nothing in the Web App names a new theme yet, so the app
looks as before, apart from a font credit at the foot of the account menu.

## Fonts

- Six fontsource packages, all SIL Open Font License 1.1: Mona Sans and JetBrains Mono (declared
  for the later Primer polish; Frost already sets code in JetBrains Mono), IBM Plex Sans, IBM Plex
  Sans Condensed (600 only) and Commit Mono for Console, and Noto Sans SC for Console's Chinese (and
  Primer's from W1a).
- Frost sets Latin and Chinese alike in MiSans by Xiaomi, at weights 400 and 500. MiSans has no
  official npm package, so `scripts/build-misans.py` cuts MiSans Regular and Medium from Xiaomi's
  official package into 99 `unicode-range` WOFF2 slices per weight under `fonts/misans/`, following
  Noto Sans SC's slice partition, and reads every slice back to confirm that its glyphs, features and
  name records are the original's. The rare ideographs outside that partition are not shipped.
  Frost turns weight synthesis off, so a bold request renders in Medium.
- A page downloads only the font files its theme names and the slices its text touches: on a
  specimen page, Frost fetched 93 KB of fonts for English and 627 KB for Chinese, and Primer, which
  names no bundled family yet, fetches none. The `@font-face` declarations are different: every
  theme's rules sit in the app's main stylesheet, so every user downloads them, about 94 KB of its
  122 KB gzipped, an accepted cost rather than loading each theme's font sheet on demand. The build
  never inlines a font into that stylesheet. A build carries 9.1 MB of fonts: 4.26 MB of MiSans,
  4.52 MB of Noto Sans SC and 0.32 MB of Latin faces.
- `scripts/sync-font-licenses.mjs` mirrors each fontsource licence into `fonts/LICENSES/`. The MiSans
  Font Intellectual Property License Agreement is transcribed there from Xiaomi's PDF and listed in
  `fonts/vendored-fonts.json`. The `penguinUi()` Vite plugin emits every licence text into each build
  as `fonts-licenses/<name>.txt`, and `fonts/README.md` records the families, their licences, the
  bytes and how to update them.
- The Web App's account menu ends with a line crediting MiSans, as its licence requires, in both
  languages.

## Tokens and hooks

- The token contract holds 188 names: `--ui-radius-control` (the pressable control's shape, bridged
  as `rounded-control`; Primer 0.375rem, Frost a pill, Console 0), `--ui-stack-0` and `--ui-stack-4`
  were added, and `--ui-glass-highlight` was removed. `themes/github.css` declares the three new names
  at the app's current values.
- `hooks.ts` lists the six style hooks, `ui-glass`, `ui-eyebrow`, `ui-display`, `ui-live`, `ui-frame`
  and `ui-underline-nav`, with the markup each recipe relies on.
- `theme.css` gives buttons, links and tabs a default transition-property list (colour,
  background and border colour, opacity and box-shadow), which any `transition-*` utility
  replaces; nothing animates until a component sets a duration.

## Themes

- `themes/modern.css` and `themes/geek.css` define every token, plus the gray and white re-pointing
  that carries the app's existing palette classes onto each theme's neutrals. As in
  `themes/github.css`, the base rule holds every token with its light value and the dark rule only
  what dark changes.
- Frost: a warm off-white canvas with white cards, pill-shaped controls with boxes on a 4–20 px
  radius scale, one green accent, regular-weight headings, untinted tight shadows, and frosted glass
  (a 16 px blur) only on menus, popovers, the modal card, the floating composer and a sticky header.
  Its dark mode is a warm near-black palette of our own, since sierra.ai has none.
- Console: a black (or white) canvas, 1 px rules, radius 0 everywhere, one orange accent, a condensed
  uppercase h1 above Plex Sans headings in sentence case, uppercase group labels, stepped live
  signals, mono only for code and data, and depth drawn with lines; the modal card carries a
  line-emphasis border instead of a shadow.
- Both themes share one type scale, with heading steps of 1.25 and nothing below .75rem, and state
  transitions of 120–200 ms. The padding-block of their controls (0.25, 0.375 and 0.625rem), rows
  (0.375rem) and menu rows (0.5rem) is Primer's, so a theme switch shifts no such height. Both carry
  the `done` and `info` tones, and every tone reads at 4.5:1 as text on its own tint and at 3:1 as a
  mark on every surface.
