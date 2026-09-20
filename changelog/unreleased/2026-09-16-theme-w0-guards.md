# The shared UI package gains its test harness and de-slop guards, and the web style guards scan both source roots

- **Date:** 2026-09-16
- **Type:** process
- **Scope:** `ui`, `web`
- **PR:** [#762](https://github.com/Prism-Shadow/penguin-harness/pull/762)

[中文版](2026-09-16-theme-w0-guards.zh.md)

The theme system's shared UI package (`@prismshadow/penguin-ui`) gained a Node-only test suite
that judges the theme files by their computed values and holds the package and the Web App to the
theme work's de-slop rules, and the Web App's style-guard tests were made to scan `packages/ui/src`
beside `packages/web/src`, failing by name when either root yields no files instead of passing over
nothing as components move between the two.

## Package tests

- `token-contract`: every theme × mode (light, dark) defines every name in `tokens.ts` — the base
  rule, plus the dark rule in dark — inside `@layer ui-theme` on the canonical selectors, once each,
  with nothing outside the contract, and a dark rule never repeats a base value; a non-default
  theme also re-points all eleven gray steps. The contract holds 188 names, with
  `--ui-radius-control` (bridged as `rounded-control`), `--ui-stack-0` and `--ui-stack-4` and without
  `--ui-glass-highlight` or `--ui-fg-on-emphasis`, and every `--ui-*` name spelled in the package,
  the Web App or the gallery (stylesheets and string literals) must be a contract name. The Web
  App's and the gallery's entry stylesheets import `themes/github.css` before the other two themes,
  whose dark rules rely on that order.
- `contrast`: WCAG 2 ratios resolved from the theme CSS — text on every surface (4.5:1), tone inks
  on the page surfaces (3:1, `neutral` exempt), tone text on its tint and solid-badge labels
  (4.5:1), and the accent label on the theme accent and on every user preset (4.5:1). Shortfalls
  are recorded in an exception list that fails once an entry starts passing.
- `no-app-strings` and `no-theme-reads`: the package imports nothing from the web app's
  dictionaries, and nothing outside the theme machinery reads the theme id.
- `demo-coverage`: every component directory carries a `*.demo.tsx`, with an empty exemption list.
- `font-licenses`: every font dependency has its licence mirrored under `src/fonts/LICENSES/`,
  matching the installed package's text, and every font the stylesheets load comes from one. A font
  with no package, listed in `src/fonts/vendored-fonts.json`, may ship only as woff2 slices in its
  own directory, with a licence text in `LICENSES/` that names its title; TTF and OTF files are
  refused everywhere.
- `boot-script`: `BOOT_SCRIPT` paints what `applyThemeAttributes` would for every combination of
  stored preferences, and `packages/web/index.html` carries it verbatim.
- A theme file that is still a stub, a package with no fonts or components yet, and an index.html
  with no inline script are reported as named skipped cases rather than passes.

## De-slop guards

- `src/testing/deslop.ts` reads Tailwind classes out of the TypeScript AST (string literals and
  template text, never comments) and out of `@apply` lists, with each JSX element's classes, direct
  children and enclosing component, and checks 22 rules: transitions name colour, opacity or shadow
  properties (transforms only in the chevron and the sheet, launcher and drawer files); no hover or
  press transforms; `duration-150` / `duration-200` or the duration tokens; nested radii; borders on
  clipping rounded boxes; halos and pulses on status marks; icons on a tint of their own ink; coloured
  left-border callouts; a tone's tint beside the same tone's line; mood words in badges; one spinner
  file and no `border-t-transparent`; gaps, stacks and padding on the rhythm steps; no literal text
  sizes; `uppercase` and wide tracking only through the eyebrow and display hooks, and no eyebrow
  directly above a heading; tabular figures in stat chips, counts and key-value values; no mono in
  button, nav, heading or menu labels; no bordered surface inside another; no gradient or backdrop
  blur without a job; shadows from the shadow tokens; colours from tokens; no emoji in dictionaries
  or fixtures; no eyebrow on a page header.
- `packages/ui/test/deslop.test.ts` runs every check over `packages/ui/src` with an empty allowlist,
  and checks the theme files' heading tokens: no h2–h5 is uppercased and no heading is set in mono.
- `packages/web/test/deslop.test.ts` runs the same checks over `packages/web/src` against an
  allowlist of the 390 hits the app holds in 99 files, counted exactly per file and rule, each entry
  naming the wave that removes it; palette classes are not checked in the Web App.
- `packages/ui/test/hooks.test.ts` holds the package, the Web App and the gallery to the six style
  hooks of `src/hooks.ts`, allows each hook only inside the components that host it, and checks the
  markup the recipes select on: `data-live` on `.ui-live`, `.ui-display` on a page title (an `h1`,
  `[aria-level="1"]` or `<Heading level={1}>`), and `head`, `body`, `foot` or `pane` slots in
  `.ui-frame`.

## Test helpers

- `src/testing/` gained a source-root scanner with per-root file counts, a CSS rule reader, a
  theme-file analyzer that resolves `var()` through the theme cascade, colour parsing (hex, `rgb()`,
  `hsl()`, `oklch()`, `color-mix(in srgb, …)`) with WCAG contrast, static-render helpers and the
  de-slop rule engine.
- `packages/ui` gained a `vitest.config.ts`; its `test` script no longer passes on an empty suite.

## Web guards

- `packages/web/test/helpers/roots.ts` names the two source roots and provides
  `expectEveryRootScanned`, `sourceFile` and `expectSingleHome`.
- The 21 style guards — `control-size`, `icon-scale`, `tone`, `disclosure-anchor`,
  `disclosure-body`, `company-click-targets`, `required-mark`, `info-popover`, `help-fold`,
  `title-reveal`, `session-activity`, `session-row-menu`, `company-beta`, `todo-notice`,
  `modal-focus`, `esc-layers`, `portal-panel-dismiss`, `context-menu`, `inner-html-stability`,
  `group-list`, `autofill` — scan both roots, assert each yielded files, and assert every module
  they read lives in exactly one place; files are named by repo-relative path.
- `GlyphIcon` draws its stroke from `--ui-icon-stroke` with a 1.7 fallback, and `icon-scale`
  asserts that and checks each theme's token against the line-family weights 1.7 / 1.6 / 1.4.
