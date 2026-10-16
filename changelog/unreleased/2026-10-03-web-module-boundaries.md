# The Web App's libraries stop importing features, and a ratchet test holds the boundary

- **Date:** 2026-10-03
- **Type:** refactor
- **Scope:** `web`

[中文版](2026-10-03-web-module-boundaries.zh.md)

Added a unit test, `packages/web/test/module-boundaries.test.ts`, that checks every static import under `packages/web/src` against three rules: a library (anything outside `features/`) imports nothing under `features/`; one feature reaches another only through its `index.ts`; no import cycle runs between feature directories. The violations that already existed were recorded in `module-boundaries.baseline.txt`, one line per edge; a violation missing from it fails the test, and so does a line that no longer occurs, so the list only shrinks.

## Details

- The code highlighter (`code-highlight.ts`, `highlighter.ts`, `highlighter.worker.ts`) moved from `features/chat/` to `lib/highlight/`; `app.tsx` and the UI gallery import it from there.
- `lib/work-mode.ts` moved into `features/company/`.
- The dismissible badges — `use-update-badges.ts`, `todo-badges.ts`, `use-project-todos.ts`, and the `todo-dismissals.ts` and `bulk-update.ts` that serve only them — moved from `lib/` to a new `features/todos/`, whose `index.ts` is what the pages and the layout import.
- The `PeakWindows` type moved from `features/models/model-grouping.ts` to `lib/peak-windows.ts`, so the dictionaries no longer import a feature.
- Nothing users see changed.
