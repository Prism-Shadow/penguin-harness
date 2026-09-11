# The Files panel gets a context menu, wrapping, and an editor that looks like the file

- **Date:** 2026-09-10
- **Type:** feature
- **Scope:** `web`
- **PR:** [#682](https://github.com/Prism-Shadow/penguin-harness/pull/682)

[中文版](2026-09-10-file-browser-context-menu.zh.md)

The dock panel that browsed the Workspace is now called 文件浏览 / Files, a secondary click on it
carries the per-entry actions it had nowhere to put, and its source view and its in-place editor
became the same presentation of the file: numbered lines, the same highlighting, the same
wrapping, and no box around either.

## Details

- Right-click, Shift+F10 and touch press-and-hold all open the menu, on a tree row and on the
  preview body alike. One handler serves the whole tree, resolving the row a gesture landed on
  from the row itself; a gesture that lands between rows keeps the browser's own menu, as does
  one inside the in-place editor, where the native menu is how text is pasted. A right-click
  inside the HTML or PDF preview goes to the iframe and never reaches the panel.
- The menu copies an entry's Workspace-relative path, adds a reference to it to the conversation,
  uploads into a folder and downloads a file.
- "Add to conversation" splices a `@path` into the composer at the caret, leaving the rest of
  the draft where it was; a directory's reference keeps its trailing slash. Nothing is sent and
  nothing is parsed — the `@` is for the reader.
- Adding a preview selection instead writes a fenced block headed by `@path (L3-L7)`, carrying
  the selection verbatim. The line range is given only where the source view can resolve it,
  and the fence is opened long enough to survive a selection that contains fences of its own.
  The text stays selected afterwards: handing a quote to the composer focuses the composer, and
  focusing a text field drops whatever the document had highlighted, so the range is put back.
- The source view numbers its lines and lost its border, its language label and its header bar —
  it presents the text the way the editor does. The toggle above it now reads **Preview / Source**:
  it names what you are looking at rather than how it was produced.
- Copy and Edit float over the top-right of the file itself. Both act on the body under them,
  while the title row names the file and carries what leaves it — the view toggle, wrap, the
  external link and download. They are always drawn rather than revealed on hover: a hover-only
  control is no control at all on a touch screen, and Edit has no other way in from here.
- The editor numbers its lines and highlights them too: it is now a transparent-text textarea
  over the same code surface the source view shows, stacked in one scroll container so the two
  layers cannot drift apart. Files over 32KB are edited unhighlighted — the editor re-highlights
  every time the text settles, and past that size the catch-up stops reading as the colours
  arriving. Line numbers stay at any size.
- The panel has one header row, not two. It names whatever is open — the directories and the
  file's own name in one strip, fitted tail first, so the filename is the last thing to go and the
  leading directories collapse into a single "…" ahead of it. The view toggle and download stay
  there because they belong to the file; wrap, copy, edit and open-in-a-new-tab float over the body
  because they act on the text; refresh and upload sit in the tree pane's header because they are
  the panel's own.
- The search box searches the **whole Workspace**, on the server, instead of filtering the rows the
  lazy tree happened to have loaded — a match used to be reachable only if its ancestors were
  already open. Results are a flat list naming each hit's full path, shallowest first, and the
  walk stops at a cap and says so rather than running a very large Workspace dry.
- A file can be renamed, moved or deleted from either context menu. Rename and move are one
  action, because both are the same write of a new path. Both carry the same precondition the
  editor's save does: the file's current version is read when the dialog opens, and the action is
  refused if the Agent rewrites the file while the question is on screen. A directory has neither,
  so neither is offered for one.
- Every action in the panel — wrap, edit, copy, open in a new tab, download, refresh and upload —
  is an icon button rather than a word. Each carries its name in its accessible name and shows it
  in a tooltip under the button, which is where a horizontal row of them needs it: a panel to the
  side would cover the buttons next to the one being asked about. While an upload runs the glyph
  becomes a spinner and the count moves into the tooltip, which is the only place left to say it;
  a preview that cannot be served from a separate origin folds that caveat into the link's name
  rather than hanging a ⚠ beside it.
- Soft wrap became a toggle in the source view as well, and the source view and the editor share
  one remembered answer: they are the same file seen two ways, and pressing Edit must not reflow
  the file under the line you were aiming at. Message code blocks still scroll sideways rather
  than wrap, which is a transcript's answer and not a file viewer's.

## Compatibility

Soft wrap now defaults to ON, in the editor as well as in the new source-view toggle. The stored
preference (`penguin.files.editorWrap`) is unchanged and still read: anyone who has ever used the
editor's Wrap toggle keeps the answer they gave, and only a browser with no stored value picks up
the new default. The key keeps its name because renaming it would silently discard those answers.
