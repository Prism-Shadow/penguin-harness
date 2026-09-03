# Files panel: a directory tree beside the preview, in-place text editing, drop to upload

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `web`, `server`, `docs`
- **PR:** [#589](https://github.com/Prism-Shadow/penguin-harness/pull/589)

[中文版](2026-09-02-workspace-tree-editor.zh.md)

The Workspace files panel became a two-pane browser — a directory tree on the left, the
selected file's preview on the right — with plain-text editing of text files and
drag-and-drop upload from the desktop.

## Details

- Tree: a directory lists its contents the first time it opens; expand/collapse chevrons,
  folder and file glyphs, the selected file highlighted, arrow-key navigation (up/down move,
  right opens or steps in, left closes or steps out). The breadcrumbs above the panes name the
  current directory. A toolbar toggle hides or shows the tree — shown by default, remembered
  under one browser-local key (`penguin.files.treeVisible`, parsed tolerantly). Below 480px
  of panel width the panel falls back to one column: the tree until a file is chosen, then
  the preview with a Back button. A message file card's click still lands on its file, now by
  opening the tree down to it.
- Preview: the same rendering as before (Markdown / HTML rendered with a source toggle, text
  highlighted, PDF embedded); images now zoom on click, and a file whose extension says
  nothing about its type is read as text when its first bytes look like text. Text reads stop
  at the 256KB cap instead of downloading the whole file.
- Editing: an **Edit** action on text files swaps the preview for a monospace text box;
  **Save** (Ctrl+S / Cmd+S) confirms, then writes through the existing
  `PUT /api/sessions/:id/files/content` endpoint and refreshes the row's size and time. A
  truncated preview stays read-only, and a save over the 14MB write limit is refused before
  it is sent. Unsaved changes ask before a file switch, before the panel's tab or dock closes
  (a close-guard registry the dock consults on its tab ×, its hide × and the toolbar toggle),
  and before the page unloads; a draft survives a Session switch and reopens with the file.
- Write precondition: `GET /api/sessions/:id/files/content` now returns the file's version in
  an `ETag` (`W/"<size>-<mtime>"`), and the write takes it back as `ifVersion` in the request
  body. The server compares it on the open write handle immediately before truncating and
  answers `409 file_changed` — having written nothing — when the file has moved on, so a save
  can no longer drop what the Agent wrote to the same file during the turn. A write that
  carries no marker is unconditional, which is what uploads and the first write of a new file
  do. The panel turns the 409 into a question: it names the file, offers **Overwrite**, and
  keeps the draft whichever way it is answered. It also stops waiting for the save to find
  out — when a turn settles the edited file is version-checked (its text is still left alone)
  and the editor header says **Changed on disk** as soon as it has.
- Upload: OS files dropped anywhere on the panel upload into the current directory, or into
  the folder row under the pointer (highlighted while hovering), using the chat area's drag
  decision helpers; the app-shell guard keeps cancelling drops elsewhere. Picks and drops
  share one path: a per-file 14MB check before anything is read, an overwrite confirmation
  against the target directory's real listing, per-file progress in the toolbar, and the
  first uploaded file opens afterwards.
- Docs: the Web App guide's Files Panel section describes the panel; the design specs'
  files-panel sentences moved with it.
