# Models page group actions stay reachable on narrow rows

- **Date:** 2026-08-18
- **Type:** fix
- **Scope:** `web`
- **PR:** [#296](https://github.com/Prism-Shadow/penguin-harness/pull/296)
- **Issue:** [#294](https://github.com/Prism-Shadow/penguin-harness/issues/294)

[中文版](2026-08-18-models-header-icon-actions.zh.md)

The models page's group headers adapted to the width the header row itself has, and every group-level action stayed reachable at every width as an icon-only control.

## Details

- The header row became a size container, so its actions respond to the row's own width rather than the viewport's. The desktop sidebar narrows the content column while the viewport still reports a desktop breakpoint, and at those widths the vendor name and the action labels had overlapped.
- "Add model", "Set API key for group", "Speed test" and the "Get API key" link shed only their text labels as the row narrowed, keeping their icons; no action is hidden outright any more. The button labels return at the `@3xl` row width and the link's at `@4xl`.
- Each icon-only control carries an accessible name giving both the action and the vendor, plus a tooltip with the action label. The external link took the external-link glyph already used elsewhere on the page, and a slightly larger hit area while icon-only.
- The layout end-to-end spec sweeps the models page from 390 to 1920 CSS pixels, asserting that every action is reachable at each width, that labels are visible exactly in the labeled regime, and that the header neither overlaps nor overflows. The expected regime is derived from the row's measured width, since the container thresholds are `rem`-based and follow the environment's root font size.
