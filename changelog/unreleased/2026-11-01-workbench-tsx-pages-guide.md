# The penguin-plugin Skill and the docs teach workbench pages in TSX

- **Date:** 2026-11-01
- **Type:** feature
- **Scope:** `skills`, `docs`
- **PR:** [#1415](https://github.com/Prism-Shadow/penguin-harness/pull/1415)

[中文版](2026-11-01-workbench-tsx-pages-guide.zh.md)

The `penguin-plugin` Skill and the docs taught agents and users to write workbench pages in TSX with `@prismshadow/penguin-ui`, which the server checks, compiles and serves. Pages in plain HTML and JavaScript stayed documented as before.

## Details

- `penguin-plugin` gained a "Pages in TSX" section with one complete page: `ui/index.html` loading the emitted `app.js`, `ui/app.tsx` importing `react`, `react-dom/client` and `@prismshadow/penguin-ui`, and a stylesheet for the page's own elements. It listed the imports a page may use and the load errors for the rest, where a page's diagnostics land, the component types the server writes into `.harness/ui/`, and how a TSX page imports the page SDK through a variable specifier.
- The Skill's Layout, "TypeScript, checked by the server", HTTP and Theme parts named the second program for `ui/`, `.build/<revision>/ui/`, the `sdk/ui/*` route, and how a TSX page is styled: component props, plus the page's own CSS over the `--ui-*` variables, with no Tailwind classes on its own markup and no `/workbench-ui.css`. The Skill's `version` became `2026.11.01.1`, so installed copies are offered the update.
- Docs: Skills & Plugins › Workbench plugins gained a paragraph and a short TSX page, in English and Chinese.
