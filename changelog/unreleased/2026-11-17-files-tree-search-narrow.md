# Files panel: the tree's search box folds into a button in a narrow column

- **Date:** 2026-11-17
- **Type:** fix
- **Scope:** `ui`, `ui-gallery`

[中文版](2026-11-17-files-tree-search-narrow.zh.md)

When the Files panel's tree column has too little room for its search box (under 140 px left beside the header's buttons), the box folds into a magnifier button beside the New, Refresh and Upload buttons. Before, it squeezed down until its placeholder was clipped to a few letters. A click opens the box across the header row with the caret in it, and the other buttons step aside while it is open. At a wider column the box is unchanged.

## Details

- An empty box folds back on Esc, on its ×, or when the focus leaves it. Esc and × give the focus back to the magnifier.
- A box holding a query stays open, also when the focus leaves it or the column narrows, so an active filter is always on screen. Its × clears the query and folds the box.
- The UI gallery's files board shows the narrow tree pane, folded and holding a query.
