# Markdown reader with an outline and in-page find; the handbook is the Files panel

- **Date:** 2026-10-15
- **Type:** feature
- **Scope:** `ui`, `web`, `server`, `ui-gallery`
- **PR:** [#1154](https://github.com/Prism-Shadow/penguin-harness/pull/1154)

[中文版](2026-10-15-markdown-reader.zh.md)

Markdown documents in the plugin detail (the README and the file browser's preview), the Benchmark case dialog and the Files panel's preview were moved onto one Markdown reader in the shared UI package, which adds an outline and an in-page find. The organization handbook became the Files panel itself, browsing the handbook directory.

## Details

- **Outline:** a document with two or more headings (h1–h4) gets an outline — a rail beside the text when the reader is at least 720px wide, otherwise a popover from the outline button. A row scrolls the reader's own box to its heading, and the current section follows the scroll.
- **Controls in the host's title row:** the outline and find buttons sit at the end of the host's existing title row, beside its own actions and in their style — the Files panel's path bar, the file browser's header line, the README section's title. A host with no title row gets a minimal strip of the reader's own above the text.
- **In-page find:** the find button, or `find.open` (Mod+F by default) while the focus is inside the reader, opens a find bar in the title row in place of the path (on a second line where the row is too narrow), never over the text: case-insensitive over the rendered text, every match highlighted, `n/total`, the first match shown as the query is typed, Enter or ↓ and Shift+Enter or ↑ to step, wrapping. Esc closes it, clears the highlights and brings the path back, without reaching a dialog around the reader. With the focus outside the reader, the key stays with the page's find bar or the browser.
- **Plugin README:** it renders through the shared Markdown pipeline instead of a bare renderer, so its code blocks carry the copy button and its links open in a new tab, like every other Markdown surface.
- **Shared find machinery:** the text matcher, the DOM index with its highlight paint, and the find bar's control row moved into `@prismshadow/penguin-ui`; `lib/find-text.ts` and `lib/find-dom.ts` re-export them, and the page's find bar draws its row through the shared `FindField`. Highlights are painted per owner, so the reader's find and the page's find bar keep their own marks; the paint takes the theme's info tone, and a formula's hidden MathML copy is no longer searched.
- **Handbook:** the page renders the Workspace Files panel over the organization's `handbook/` directory through the Files panel's directory-addressed routes, so its tree, search, toolbar, path bar, preview, editor and menus are the Files panel's. It keeps only what the Files panel has no counterpart for: it opens the index on arrival, offers no rename, move or delete on the index, and offers no "add to conversation". The page's own heading, its explanation and the "index · read first" mark were removed, and names created or renamed from the page follow the Files panel's rules rather than the handbook routes' path rule.
- **Server:** `GET /api/projects/:projectId/organizations/:orgId/handbook/files` also returns `dir`, the handbook directory's absolute path.
- **Files frame:** the Files panel's toolbar row, its two-pane layout and the tree-width rules moved into `@prismshadow/penguin-ui` (`FilesToolbar`, `FilesPanes`, `useFilesLayout`); `lib/workspace-tree.ts` re-exports the layout helpers. The Files panel shows Edit for a rendered Markdown file in its path bar rather than over the text, and takes an optional composer hand-off and a set of files to keep in place.
- **Gallery:** the content board shows the reader over a long document under a title row holding its controls, wide and narrow, in both languages.
