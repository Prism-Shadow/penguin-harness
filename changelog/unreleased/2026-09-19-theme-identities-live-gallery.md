# The three themes look like three themes, and the gallery plays interactions

- **Date:** 2026-09-19
- **Type:** process
- **Scope:** `ui`, `ui-gallery`
- **PR:** [#795](https://github.com/Prism-Shadow/penguin-harness/pull/795)

[中文版](2026-09-19-theme-identities-live-gallery.zh.md)

Frost and Console were redesigned so that the three themes no longer share one silhouette, and the
component gallery gained live variants that play an interaction frame by frame in every theme. Primer is
unchanged pixel for pixel, and so is the Web App, which renders only Primer until the theme switcher
opens.

## Themes

- Sizes are no longer shared across themes. A new space-unit token is bridged to Tailwind's `--spacing`,
  so every spacing and size utility scales with the theme: Primer keeps the stock 0.25rem, Frost is
  roomier (0.28rem, a 15px body) and Console denser (0.225rem, a 13px body). `text-sm` and `text-xs`
  follow each theme's body and small rungs.
- Frost takes Sierra's colour field back: a warm field behind the app window, the navigation column
  on the field and the main column as a floating rounded sheet, generous box radii, pill controls and
  regular-weight large titles.
- Console becomes a monospaced interface in the manner of opencode.ai: navigation, buttons, labels,
  headings, badges and tables are set in Commit Mono, while reading surfaces (message text, answer
  Markdown, the composer's input) stay in IBM Plex Sans. Paper-white and warm near-black modes, the
  orange accent, square corners, a ruled full-bleed window with a `>` before the selected navigation
  row, and boxes whose head title sits in the top rule.
- A seventh style hook, `ui-shell`, carries the app window (`data-slot="nav"` / `"main"`); its only
  host is `AppShell`. A new `--ui-font-ui` token is the face of the chrome (`body` reads it), beside
  `--ui-font-sans` for reading.
- The token contract grew from 188 to 210 names: the shell group, `--ui-font-ui`, the space unit, and
  eleven motion tokens for entering, leaving, revealing and resizing.

## Motion

- Components declare motion with four data attributes — `data-presence` with `data-side`,
  `data-backdrop`, `data-reveal` and `data-layout-motion` — and `theme.css` animates them from the
  theme's tokens: Primer fades with a 4px slide, Frost springs in from 0.96 with a blur that clears and
  streams text in word by word, Console steps with no fade. Reduced motion shows every end state at
  once.

## Gallery

- Six modules gained a live variant: Streaming reply (conversation), Type and send (composer),
  Collapse and expand (navigation), Open and close (overlays: menu, dialog, toast), Run to finish
  (status) and Expand a folder (files). Each is a list of frames the card plays on a clock and loops.
- A card autoplays while it is on screen. Its foot carries a transport: play and pause, restart,
  previous and next frame, frame chips that jump, and 0.5× / 1× / 2×. In compare mode the three
  themes share the card's clock, so they show the same frame at the same moment.
- `/embed?module=&variant=&frame=&play=` addresses a frame. By default a live variant is paused on its
  last frame. Screenshots of a live variant are named `<module>--<variant>@<frame>.png`, one per frame
  with `--variants all`. A paused card's breadcrumb names its frame.
- The Foundations Motion board replays each motion specimen, and the Density and Shape boards show the
  space unit and the shell.
