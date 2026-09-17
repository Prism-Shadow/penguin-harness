---
title: Files panel
description: Browse, preview, edit, and manage the files in a conversation's Workspace.
---

The **Files** panel is one of the chat page's side panels. It shows the Workspace of the open conversation: a directory tree on the left, and a preview of the selected file on the right. Every member of the Project can browse, preview, edit, upload, rename and delete files here.

- To get started, see [Open the Files panel](#open-the-files-panel).
- To find a file, see [Search the Workspace](#search-the-workspace).
- To change files, see [Edit a text file](#edit-a-text-file) and [Use the context menu](#use-the-context-menu).
- To add files, see [Upload files](#upload-files).

## Open the Files panel

Open the panel from any of these places:

- The top right of the chat toolbar: select **Right sidebar** or **Bottom panel**, then choose **Files**. If the dock already shows other panels, use its **Add panel** menu.
- The **Shortcuts** launcher on the conversation's right edge.
- A message: select a file chip or file card to open the panel at that file. A link in a reply that names a file in the Workspace opens it here too, instead of navigating the browser; whether the file exists is not checked first, so the panel says when it is missing.

The panel is available once the conversation has started. See [Use side panels](/chat#use-side-panels).

## Browse the file tree

The tree lists the contents of a directory the first time you open it. File rows show the file size after the name. Point at a row to see its path, size, and modified time.

The tree pane's header holds the search box, **Refresh** and **Upload**.

The path row above the preview names the open file. The leading directories collapse into a single `…` first, and the file name is the last thing to go. When no file is open, the path row names the current directory. The root reads `.`, and the Workspace's absolute path lives in the Session details card.

The tree and the open preview re-read when a turn finishes. The tree also re-reads when the panel comes back into view.

### Move with the keyboard

- Up and down move the selection.
- Right opens a directory or steps into it.
- Left closes a directory or steps out.
- Home and End jump to the first or last row.
- Enter and Space act like a click.

### Hide the tree or change its width

At the left end of the panel's header row, select **Hide file tree** to slide the tree out of the panel's left edge. The search box, **Refresh** and **Upload** are hidden with it. Select **Show file tree** to bring the tree back. The tree is shown by default, and the panel remembers your choice in the browser.

Drag the divider between the two panes to set the tree's width. When the divider has focus, the arrow keys nudge it. The panel remembers the width too.

When the panel is narrower than 480px, it falls back to a single column: the tree until you choose a file, then the preview with a **Back to list** button.

## Search the Workspace

The search box searches the whole Workspace on the server, not only the directories you have opened.

1. In the tree pane's header, select the **Search files** box.
2. Enter part of a file or directory name.

A moment after you stop typing, the results appear as a flat list of full paths, shallowest first. While the search runs, the box shows "Searching…". Search matches entry names and ignores case.

A search stops at 200 matches or 20,000 entries walked. It then shows "Too many matches — showing the first N". When nothing matches, it shows "No matches in the Workspace".

Select a directory in the results to clear the search and open that directory in the tree. Press Esc or select the clear button to empty the box.

## Preview a file

Select a file in the tree to open it in the preview. How a file is shown depends on its type:

| File type | How it is shown |
| --- | --- |
| Markdown and HTML | Rendered, with a **Preview / Source** toggle |
| Text | With syntax highlighting and line numbers |
| Images | Inline. Select the image to zoom. |
| PDF | Embedded |
| Anything else | Offered as a download. See [Download a file](#download-a-file). |

A file whose extension says nothing about its type, such as a `Makefile` or a `LICENSE`, is read as text when its bytes look like text.

A Markdown file larger than 64KB opens in the source view. You can still switch to the rendered view. In rendered Markdown, a relative link opens that Workspace file in the panel, and relative images load.

An HTML file can also be opened in a new browser tab: in the preview, select **Open in new tab**.

> [!NOTE]
> When the app is reached through an address with no separate preview origin, the tab opens sandboxed, without localStorage, cookies or third-party embeds. To avoid the sandbox, reach the app over 127.0.0.1 or localhost, or set `PENGUIN_PREVIEW_ORIGIN`.

A text preview reads up to 1MB. A larger file is shown truncated, with the message "File too large; preview truncated, download for the full file", and cannot be edited here. **Download** is in the preview header.

Three buttons float over the top right of the file view: **Copy code**, **Wrap** and **Edit**. **Wrap** soft-wraps long lines and is on by default. The source view and the editor share the one remembered choice.

## Edit a text file

1. Open the file in the preview, then select **Edit** at the top right of the file view. The preview becomes an editor: the same highlighted text with line numbers, now editable. There is no rich editor.
2. Make your changes.
3. Select **Save** (the check mark), or press Ctrl+S / Cmd+S.
4. In the **Save file** dialog, select **Save** to write the file back.

Select **Cancel** (×) to return to the preview without saving.

The panel asks before your unsaved changes are lost: when you switch to another file, close the panel's tab, or leave the page.

> [!TIP]
> Collapsing or hiding the dock loses nothing. The panel stays exactly as it was, preview, tree and draft included, and comes back untouched without asking.

A draft survives switching to another Session. Open the same file again to reopen the editor on it, with a "Restored unsaved changes" notice.

A save over the 14MB write limit is refused with a message.

## Handle a file that changed on disk

The agent writes to the same Workspace, so a file can change while you are editing it. The panel checks for changes whenever a turn finishes. Your text is never replaced. As soon as the file has changed on disk, the editor header shows **Changed on disk**.

A save that would land on a changed file is refused before anything is written. The **File changed on disk** dialog asks whether to **Overwrite** the file with your version or keep editing. Your text is kept either way.

## Use the context menu

Right-click a tree row or the file view to open the context menu. On a touch screen, long-press. On a keyboard, press Shift+F10 or the menu key.

> [!NOTE]
> The context menu does not open inside an HTML or PDF preview, or inside the editor, where the browser's own menu is how text is pasted.

| Menu item | What it does | Available for |
| --- | --- | --- |
| **Copy relative path** | Copies the path from the Workspace root. | Files and directories |
| **Add to conversation** | Adds a reference to the file or directory to the composer as a chip. A directory's path ends in `/`. Nothing is sent until you send the message. | Files and directories |
| **Add selection to conversation** | On send, the message carries the selected text as a code block headed by the file and line range, such as `@src/app.ts:12-18`. | Files, in the file view, with text selected |
| **Upload here** | Uploads into this directory. See [Upload files](#upload-files). | Directories |
| **Download** | Downloads the file. See [Download a file](#download-a-file). | Files |
| **Rename or move** | Enter a **New path** relative to the Workspace root and select **Move**. Missing directories are created. An existing target is refused. | Files |
| **Delete** | Deletes the file after a confirmation. The file does not go to a trash folder. | Files |

> [!NOTE]
> Rename, move and delete read the file's current version first. If the agent rewrote the file while the dialog was open, they change nothing.

## Upload files

### Upload with the button

1. In the tree, open the directory the files should go into.
2. In the tree pane's header, select **Upload**.
3. Select one or more files.

The panel uploads several files at a time into the current directory. Each file can be up to 14MB; oversize files are named and skipped before anything is read. If the target directory already contains a file with the same name, the **Overwrite existing files** dialog lists the clashes, and selecting **Upload** overwrites them. When the upload finishes, the first uploaded file opens, unless the editor holds unsaved changes.

### Upload with drag and drop

Drag files from your computer onto the panel. A dashed frame names the directory the files will land in ("Drop to upload into …").

- Drop onto a directory row to upload into that directory. The row highlights while the drag is over it.
- Drop onto a file row to upload into that file's directory.
- Dropped folders are skipped with a notice.

> [!NOTE]
> Dropping files onto the conversation or the composer attaches them to your message instead of uploading them. See [Chat](/chat#drag-files-onto-the-chat).

## Download a file

1. Select the file in the tree to open it in the preview.
2. In the preview header, select **Download**.

In the desktop app's own window, a **Show in folder** button sits beside **Download**. Select it to open the file's directory in the system file manager. Finder and Explorer select the file; a Linux desktop opens the directory.

> [!NOTE]
> **Show in folder** appears only in the desktop app's own window. A browser signed into the same server does not get the button, even on the same machine, because the server cannot tell it from a remote one.

## Limits

| Limit | Value |
| --- | --- |
| Text preview | Up to 1MB. Larger files are shown truncated and cannot be edited here. |
| Markdown rendering | Up to 64KB. Larger files open in the source view. |
| Upload size | 14MB per file |
| Save size | 14MB per file |
| Search | Stops at 200 matches or 20,000 entries walked |
| Panel width | Below 480px, the panel falls back to one column |
