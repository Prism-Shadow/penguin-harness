# The web guards cover the library web halves and the halves shed their reverse dependencies

- **Date:** 2026-11-27
- **Type:** fix
- **Scope:** `web`, `library/workbench`, `library/organization`, `ui-gallery`

[中文版](2026-11-27-web-guards-cover-library-halves.zh.md)

The Web App's structural tests now scan the workbench and organization web halves alongside the Web App's own sources, and the library packages no longer list the Web App as a dependency.

## Details

- `@prismshadow/penguin-library-workbench` and `@prismshadow/penguin-library-organization` drop `@prismshadow/penguin-web` from their dependencies. The faces still resolve through the shared path aliases, so nothing is imported twice and no build-order cycle remains.
- Each package's `./web/*` wildcard export becomes one explicit entry per page, pointing at its source file. The package manifest now states exactly which pages it serves.
- The organization package drops its copy of the canvas view helpers and reaches the host's implementation through `@prismshadow/penguin-web/internal`, the same seam it already uses for state, api and components. Its navigation module forwards the host's named exports instead of re-exporting the whole internal hub.
- The web and ui-gallery stylesheets add `@source` entries for the two web halves, so Tailwind keeps emitting the classes the moved pages use.
- The module boundary test resolves the bare `@prismshadow` aliases and scans both halves. Its baseline keeps the pre-move cycle records under the entries they were written against, and the list still only shrinks.
- The form commit guard, the native title guard, the menu style guard, the shortcut guard, the clipboard test and the highlighter worker test all include the two web halves in their scans. The halves' pages already satisfy them.
- The managed-browser page shows a tab's URL hint through the shared tooltip (`data-tooltip`) instead of a native `title`, the one hit the title guard's wider scan turned up.
- Vitest coverage counts the halves' sources, and the ui gallery dev server watches them, so an edit to a half rebuilds the gallery and shows up in coverage.
