# Files panel: new folders and text files, folder rename, a VS Code-like editor, and the panel on the new-chat page

- **Date:** 2026-10-01
- **Type:** feature
- **Scope:** `web`, `ui`, `server`, `docs`

[中文版](2026-10-01-files-panel-folders.zh.md)

The Files panel gained **New text file** and **New folder**, folders can be renamed and moved, the editor keeps its place like a code editor, and the panel opens on the new-chat page for the folder picked there, including from a sidebar Workspace group's new **Browse files**.

## New files and folders

- A **New** menu in the tree pane's header creates in the current directory, a folder's context menu creates inside that folder, and the blank space under the tree creates at the Workspace root.
- A name dialog follows. A text file starts as `untitled.txt` with `untitled` selected, and a `/` in the name creates the folders in between. Enter creates.
- A new folder opens in the tree and becomes the current directory. A new text file is empty and opens in the editor, unless the editor holds unsaved changes.
- A taken name is refused with nothing written, and the dialog stays open on it. The server's `POST files/create` answers 409 `target_exists`, and it does not follow a link at the path.

## Folder rename

- Folders take the same **Rename or move** dialog as files and move whole. An occupied destination and a move into the folder's own subtree are refused.
- A folder has no version marker, so it moves without one. `POST files/move` accepts a folder and refuses a folder sent with `ifVersion`.
- The open folders, the current directory and an open file follow the new path. A file's rename now follows it too, instead of leaving the preview waiting on the old path.

## Editing like a code editor

- **Edit** opens the editor where the preview was scrolled, with the cursor at the start of the first line in view.
- Saving leaves the editor open, with the cursor, the selection and the scroll untouched. `PUT files/content` answers with the version it wrote in `ETag`, and the next save carries it.
- When a finished turn rewrote the open file and the editor holds no unsaved changes, the editor takes the new text in place, keeping the cursor's line and the scroll. With unsaved changes the text is kept, **Changed on disk** shows, and the save asks as before.
- **Stop editing** (×, formerly **Cancel**) returns to the preview where the editor was scrolled.

## The Files panel without a Session

- On the new-chat page, a **Files** toggle right of the Workspace pill opens the dock's Files panel on the folder picked there, and picking another folder re-roots it. **Add to conversation** adds to the new chat's composer. With a temporary workspace the toggle is unavailable, and its tooltip says why.
- A Workspace group's **…** menu in the sidebar offers **Browse files** for any group that is one folder. When the page on screen is already in that folder, the panel opens in place. Otherwise the new-chat page opens on the folder with the panel.
- The panel addresses such a folder by its path through `/api/projects/:projectId/workspace-files`, the same operations as a Session's file routes, under Project access. HTML there previews in the same-origin sandbox.

## Copies

- The docs state that **Copy relative path** writes the Workspace-relative path to the clipboard of the computer the browser runs on, also over plain HTTP. The fallback for plain HTTP landed in [#523](https://github.com/Prism-Shadow/penguin-harness/pull/523), and a browser test (`files-folders.spec.mjs`) now covers it.
