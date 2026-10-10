# The shared UI package, its token contract, and the default theme wired into the Web App

- **Date:** 2026-09-16
- **Type:** refactor
- **Scope:** `ui`, `web`, `ci`
- **PR:** [#765](https://github.com/Prism-Shadow/penguin-harness/pull/765)

[中文版](2026-09-16-penguin-ui-token-contract.zh.md)

The first step of the theme system. A private, source-only package, `@prismshadow/penguin-ui`
(`packages/ui`), took over the Web App's colours, radii, shadows, fonts and focus and scrollbar
rules as one named set of design tokens, and the current look became its default theme, `github`,
value for value: the twelve pages the pixel diff covers render identically in both modes and both
languages, and the one rule whose font stack moved, `.font-sans`, is described below. The one
intended visible change is on first load: the stored light/dark mode, accent and font size are
applied before the first frame, so a dark page no longer flashes white while the bundle loads and
the first frame no longer renders at 16px and reflows to the 18px default.

## Details

- `tokens.ts` holds the contract: 186 `--ui-*` names in 15 groups (surfaces, text, lines, accent,
  six semantic tones × five parts including the new `done` and `info`, charts, code and diff,
  shape, elevation and glass, type families, the type and heading scale, density, motion, icons,
  focus/selection/scrollbar), plus the theme ids `github` / `modern` / `geek`.
- `theme.css` declares the `dark` variant, two cascade layers after Tailwind's own (`ui-theme`,
  then `ui-accent`, so an accent preset always beats a theme's dark block), a bridge that exposes
  the tokens as utilities (`bg-surface`, `text-fg-muted`, `border-line`, `bg-accent`,
  `text-tone-danger-fg`, …) and re-points Tailwind's font, radius and shadow scales at them, the
  base rules that read tokens, and the five accent presets.
- `.font-sans` reads the app's own sans stack (`--ui-font-sans`) instead of Tailwind's stock
  `ui-sans-serif, system-ui, sans-serif, …`. One element uses the class, the full-prompt preview
  folded into the Create-with-AI dialogs: its Latin text keeps its face (`system-ui` is second in
  both stacks), and its CJK text now resolves through the named PingFang SC / Microsoft YaHei
  instead of the OS fallback, the same face on most systems but not guaranteed on Windows.
- `themes/github.css` defines every token with the app's existing values, and a gray bridge that
  re-points Tailwind's `--color-gray-*` and `--color-white`, so the existing gray classes follow
  the theme with no component edits. Its base rule holds every token; its dark rule holds only the
  values dark changes, so a mode-independent group (shape, type, density, motion, icons) is
  written once. `themes/modern.css` and `themes/geek.css` were added as empty placeholders.
- `boot.ts` generates the pre-paint script now inlined in `packages/web/index.html`, and the
  `applyThemeAttributes()` the theme provider reconciles with. The dark `theme-color` became
  `#000000`, the page's real dark background.
- The theme provider gained a stored theme id (`penguin.themeId`, default `github`), applied as
  `html[data-theme]`; no setting exposes it yet. The key is classified as a browser preference for
  the data-root sweep.
- The Web App depends on the package as `workspace:*`, which pnpm links to `packages/ui`, so Vite,
  vitest and tsc read its live source through the package's `exports`, and Tailwind scans the
  package's source. `styles.css` dropped the rules the package now owns.
- Call sites that spelled `var(--accent-bg)` / `var(--accent-fg)` moved to `bg-accent`,
  `border-accent`, `ring-accent` and `text-accent-fg`, and the three `bg-black/45` dialog backdrops
  moved to the `--ui-overlay-backdrop` token. `--accent-bg` / `--accent-fg` remain as aliases for
  one wave.
- `packages/web/scripts/theme-shots.mjs` captures twelve pages × light/dark × en/zh from any
  number of web builds against one server, one data set and a frozen clock, and diffs the shot
  trees pixel for pixel.
- The CI `web-cli` shard runs the new package's tests, and the port table in
  `packages/core/src/internal/ports.ts` reserves 7372 for the component gallery's dev server.
