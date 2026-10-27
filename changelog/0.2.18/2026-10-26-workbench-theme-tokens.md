# Workbench pages follow the app's theme through the token contract

- **Date:** 2026-10-26
- **Type:** feature
- **Scope:** `web`
- **PR:** [#1346](https://github.com/Prism-Shadow/penguin-harness/pull/1346)

[中文版](2026-10-26-workbench-theme-tokens.zh.md)

The Web App copies its whole resolved theme into a workbench page's frame, where it used to copy only the gray scale, the accent pair and the font stack, and `/workbench-ui.css` maps the workbench's names onto it. A page that uses those names takes the theme's surfaces, lines, radius, faces and status tones under every theme.

## Details

- The frame's root gets the `light` / `dark` class, `data-theme` (always written, `github` included), `data-accent` (only when the theme paints that preset), `data-font-latin` / `data-font-cjk`, the root font size and every `--ui-*` token of the UI package's contract, resolved. The app's `@font-face` rules are copied into the frame's head with absolute URLs, so the theme's own faces load there too. All of it is copied again on every theme, mode, accent, text size or font change, and on every page load.
- Every `--wb-*` name and `wb-*` class stays. The names now map onto tokens: `--wb-bg` → `--ui-canvas`, `--wb-surface` → `--ui-surface-muted`, `--wb-fg` → `--ui-fg`, `--wb-muted` → `--ui-fg-muted`, `--wb-border` → `--ui-line`, `--wb-hover` → `--ui-fill-neutral`, `--wb-accent` / `--wb-accent-fg` → `--ui-accent` / `--ui-accent-fg`, `--wb-radius` → `--ui-radius-md`, `--wb-font` → `--ui-font-ui`, `--wb-mono` → `--ui-font-mono`. Body text and code take the theme's body and code sizes.
- New: `--wb-tone-<tone>-fg`, `-bg` and `-line` for the tones `success`, `attention`, `danger`, `done`, `neutral` and `info`, and the `.wb-badge` label pill, whose `data-tone` picks one of them (none is `neutral`).
- A page opened outside the app falls back to Primer's values, light or dark by the viewer's system preference.
