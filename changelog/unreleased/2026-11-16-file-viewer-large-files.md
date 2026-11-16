# Files panel: a 200 KB file opens and scrolls without freezing the window

- **Date:** 2026-11-16
- **Type:** fix
- **Scope:** `ui`, `web`
- **Breaking:** yes — `@prismshadow/penguin-ui` no longer exports `EditorScroll`; `WorkspaceFileEditor`'s `initialScroll` takes a `CodePlace`

[中文版](2026-11-16-file-viewer-large-files.zh.md)

The numbered code surface of the shared UI package (the Files panel's source view and editor, and the memory file viewers) lays out and paints only the lines near the screen. Opening a large source file no longer blocks the window for seconds, and scrolling it keeps up with the wheel. Every line stays in the page, so find in page, select all, copy and the selection's line range work as before.

## Details

- The lines are drawn in chunks of 100, and `content-visibility: auto` skips a chunk that is off screen. An undrawn chunk stands at its expected size. Unwrapped that size is exact. Wrapped it is estimated from the lines' lengths and the measured columns, so on a large wrapped file the scroll bar is approximate until the file has been scrolled through.
- In a wrapped view the line numbers are no longer `position: sticky`: nothing scrolls sideways there, and the sticky numbers, one per line, made every scroll step repaint the whole file.
- The highlighted markup is cut into lines as a string, by the diff viewer's `splitHighlightedLines`, which moved into `code-block/code-lines.ts`. It is no longer parsed into a second DOM.
- Edit opens on the line the source view had at its top, at the same distance from the edge, and leaving the editor puts the source view back on the editor's line. The two views lay out off-screen lines differently, so the place is carried as a line (`readCodePlace` / `restoreCodePlace`), not as a pixel offset.
- A rendered Markdown file in the Files panel is no longer parsed again, and its images and links are no longer remounted, every time the reader scrolls past a heading.
- The ui-gallery's Code board shows a long wrapped code surface.

## Compatibility

`EditorScroll` is no longer exported from `@prismshadow/penguin-ui`. A caller that passed `initialScroll={{ top, left }}` to `WorkspaceFileEditor` passes `readCodePlace(box)` of the box it scrolled instead.
