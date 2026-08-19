# Composer attachments: drag files onto the chat area

- **Date:** 2026-08-18
- **Type:** feature
- **Scope:** `web`, `docs`
- **PR:** [#319](https://github.com/Prism-Shadow/penguin-harness/pull/319)
- **Issue:** [#311](https://github.com/Prism-Shadow/penguin-harness/issues/311)

[中文版](2026-08-18-web-drag-drop-upload.zh.md)

Dragging OS files onto the **chat area** — the conversation and the composer — became a third entry point into the composer's existing attachment intake, alongside the "+" menu's pickers and image paste. Until then a file dropped on the page got the browser's default: the tab navigated to the file, replacing the running app and any unsent draft.

## Dropping on the chat area

- A file drag over the chat area shows a "Drop files to attach" overlay bounded to that region, and releasing hands the whole batch to the composer. It works on the chat page and the draft page alike, and while a Task is running just the same.
- Images join the pasted-image pipeline (`image_url` parts; vision-less models keep the scratchpad-path fallback), everything else becomes a file attachment (scratchpad plus an `[attached file: <path>]` line). Validation and errors match the "+" menu — an oversize file is refused before it is read, with the existing toast.
- Goal mode takes dropped images and refuses dropped files with a toast, the same rule that grays out the "+" menu's file entry there.
- Non-file drags are ignored everywhere — text selections, dragged links and page images, the sidebar's session reorder — so dropping selected text into the composer still inserts it natively.

## Outside the chat area

- The sidebar, the top bar, the conversation toolbar, the docked Files and Subagents panels and every page without a composer sit outside the drop target: no overlay lights up and nothing is attached.
- An app-shell guard (`guardWindowDragOver` / `guardWindowDrop`) cancels the browser's navigate-to-file default for any file drag the chat area did not claim, and shows the no-drop cursor while such a drag hovers. It was kept deliberately silent — no overlay, no attachment, no toast — so that a file dropped there does nothing at all instead of discarding the app.

## Details

- The overlay is re-derived on every event from the drag's current position rather than accumulated from enter/leave counts, so a drag that ends outside the browser — firing neither `drop` nor `dragend` — cannot strand it on screen.
- The decision logic — file-drag detection, the region hit test, batch splitting and the shell guard — landed in `packages/web/src/lib/file-drop.ts`, kept DOM-free and covered by unit tests; `ChatDropRegion` and `FileDropZone` in `packages/web/src/features/chat/drop-zone.tsx` bind it to the chat column and the composer.
- The web-app docs page describes the flow in both languages.
