# The Files panel gets a context menu, and its source view gets line numbers

- **Date:** 2026-09-10
- **Type:** feature
- **Scope:** `web`
- **PR:** [#PR](https://github.com/Prism-Shadow/penguin-harness/pull/PR)

[中文版](2026-09-10-file-browser-context-menu.zh.md)

The dock panel that browsed the Workspace is now called 文件浏览 / Files, and a secondary click
on it carries the per-entry actions it had nowhere to put: copy an entry's Workspace-relative
path, add a reference to it to the conversation, upload into a folder, download a file. The
same menu opens on the preview body for the file on screen, where it can also hand the
conversation the text currently selected rather than the whole file.

## Details

- Right-click, Shift+F10 and touch press-and-hold all open the menu, on a tree row and on the
  preview body alike. One handler serves the whole tree, resolving the row a gesture landed on
  from the row itself; a gesture that lands between rows keeps the browser's own menu, as does
  one inside the in-place editor, where the native menu is how text is pasted. A right-click
  inside the HTML or PDF preview goes to the iframe and never reaches the panel.
- "Add to conversation" splices a `@path` into the composer at the caret, leaving the rest of
  the draft where it was; a directory's reference keeps its trailing slash. Nothing is sent and
  nothing is parsed — the `@` is for the reader.
- Adding a preview selection instead writes a fenced block headed by `@path (L3-L7)`, carrying
  the selection verbatim. The line range is given only where the source view can resolve it,
  and the fence is opened long enough to survive a selection that contains fences of its own.
- The source view numbers its lines, gutter sticky at the left edge while the code scrolls
  sideways. The numbers are not selectable and are not part of what the copy button copies.
