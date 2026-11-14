# List rows keep their actions in view, however long their text

- **Date:** 2026-10-15
- **Type:** fix
- **Scope:** `ui`, `ui-gallery`, `skills`
- **PR:** [#1157](https://github.com/Prism-Shadow/penguin-harness/pull/1157)

[中文版](2026-10-15-list-row-actions-visible.zh.md)

In Agent settings → Memory, one memory with a long description laid every row of its section out wider than the card, so the card clipped the view, edit and delete buttons on every row, the short rows' too; a longer description pushed the date off as well. The shared list row and the collapsible section were fixed in `packages/ui`, so every list built on them holds the same way.

## Details

- `CollapsibleSection` holds its body to the card's width (`min-width: 0` on the fold's grid item, as `Fold` already did). Its body's `auto` column had grown to the longest row's full text width.
- `ListRow` no longer asks its container for its text's width: title and description sit in a one-column `minmax(0, 1fr)` grid, so a row's narrowest width is its mark, date and actions, whatever container it is in. Title and description still truncate to one line each and show whole on hover; the date and actions keep their width and wrap under the text at narrow widths.
- `ListRow` puts at most 1,000 characters of a string title or description on the page, ending in an ellipsis, and carries the whole string in the line's hover hint, so a description of any length costs a row the layout of a thousand characters at most.
- The component library's data board gained a section of memory rows with very long Chinese and English text, and the gallery a Playwright check (`pnpm --filter @prismshadow/penguin-ui-gallery test:e2e`) that measures every row and action against its card in each theme, both languages and the largest text size, at the board's width and narrowed to 220 px.
- The frontend skill states the rule: a row's text gives way, its actions never do.
