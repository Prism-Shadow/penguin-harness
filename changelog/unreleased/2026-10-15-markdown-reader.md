# Markdown reader with an outline and in-page find; the handbook on the Files panel's frame

- **Date:** 2026-10-15
- **Type:** feature
- **Scope:** `ui`, `web`, `ui-gallery`

[中文版](2026-10-15-markdown-reader.zh.md)

Markdown documents in the plugin detail (the README and the file browser's preview), the Benchmark case dialog, the Files panel's preview and the organization handbook were moved onto one Markdown reader in the shared UI package, which adds an outline and an in-page find. The handbook's browser was rebuilt on the Workspace Files panel's frame.

## Details

- **Outline:** a document with two or more headings (h1–h4) gets an outline — a rail beside the text when the reader is at least 720px wide, otherwise a popover from the reader's tool pill. A row scrolls the reader's own box to its heading, and the current section follows the scroll.
- **In-page find:** the pill's find button, or `find.open` (Mod+F by default) while the focus is inside the reader, opens a find box over the rendered text: case-insensitive, every match highlighted, `n/total`, the first match shown as the query is typed, Enter or ↓ and Shift+Enter or ↑ to step, wrapping. Esc closes it and clears the highlights without reaching a dialog around the reader. With the focus outside the reader, the key stays with the page's find bar or the browser.
- **Plugin README:** it renders through the shared Markdown pipeline instead of a bare renderer, so its code blocks carry the copy button and its links open in a new tab, like every other Markdown surface.
- **Shared find machinery:** the text matcher, the DOM index with its highlight paint, and the find bar's control row moved into `@prismshadow/penguin-ui`; `lib/find-text.ts` and `lib/find-dom.ts` re-export them, and the page's find bar draws its row through the shared `FindField`. Highlights are painted per owner, so the reader's find and the page's find bar keep their own marks; the paint takes the theme's info tone, and a formula's hidden MathML copy is no longer searched.
- **Handbook:** the tree pane carries a path filter and the New document and Collapse all actions; the toolbar holds the tree toggle, the document's breadcrumbs, the index mark, the modified time and the document's actions (delete, or cancel and save while editing); the divider resizes the tree, and below 480px one column shows the tree or the document with a way back. Edit opens the Files panel's in-place editor, and Save writes the file and returns to reading. The tree's visibility and width last as long as the page.
- **Files frame:** the Files panel's toolbar row, its two-pane layout and the tree-width rules moved into `@prismshadow/penguin-ui` (`FilesToolbar`, `FilesPanes`, `useFilesLayout`); the Workspace Files panel and the handbook both lay out with them, and `lib/workspace-tree.ts` re-exports the layout helpers.
- **Gallery:** the content board shows the reader over a long document, wide and narrow, in both languages.
