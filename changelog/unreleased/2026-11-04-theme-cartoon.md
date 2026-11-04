# A fourth theme, Doodle, drawn by hand

- **Date:** 2026-11-04
- **Type:** feature
- **Scope:** `ui`, `web`, `ui-gallery`
- **PR:** [#1473](https://github.com/Prism-Shadow/penguin-harness/pull/1473)

[中文版](2026-11-04-theme-cartoon.zh.md)

Settings › Appearance and the gallery's theme switcher gained a fourth theme, Doodle (卡通, id `cartoon`): paper and ink in solid colour, every box edged with a pen line, in light and in dark (chalk on dark paper).

## Details

- The line is one hand-drawn rounded rectangle per size, drawn once from a fixed seed (`packages/ui/scripts/draw-doodle-edges.mjs`) and laid on a box's edge as a CSS `border-image` 9-slice. It reaches boxed buttons, text fields, select triggers and the person's own message bubbles through a new style hook, `ui-edge`, and cards, code blocks, dialogs, menus, popovers, tooltips, the composer, notices and widgets through their existing hooks. Text is never drawn on, the shape never changes on hover or re-render, and forced colours fall back to the plain border. The other three themes treat `ui-edge` as a no-op.
- Type: Shantell Sans for Latin (`@fontsource-variable/shantell-sans`, SIL OFL 1.1) and LXGW WenKai GB Screen 1.530 for Chinese (SIL OFL 1.1). WenKai ships as the 48 slices of its web release that hold every character of the GB2312 grid (2.8 MB), vendored by `packages/ui/scripts/vendor-wenkai.mjs` from the pinned `lxgw-wenkai-screen-web` tarball; rarer characters fall back to Noto Sans SC. Both faces are credited with their licence texts.
- Accent: the theme's own is black and white like the others; five pen presets (marker, ballpoint, grass, crayon, grape) join the accent picker.
- A theme id the running build does not know (one a newer build synced through the account) keeps showing the default theme and stays stored as it was.
