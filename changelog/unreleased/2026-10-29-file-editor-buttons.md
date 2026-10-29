# The Files panel editor's ✓ saves and closes, ✗ discards, and its line numbers stop flickering

- **Date:** 2026-10-29
- **Type:** fix
- **Scope:** `web`, `ui`

[中文版](2026-10-29-file-editor-buttons.zh.md)

In the Files panel's editor, ✓ and ✗ became a matched pair from one icon family, drawn the same size. ✓ saves and returns to the preview, after the usual overwrite confirmation; with nothing changed it just returns. ✗ is Discard changes: it drops the unsaved text and returns to the preview without a second question. The save shortcut still saves and keeps the editor open.

## Details

- A save that is refused (the file changed on disk, or the write failed) keeps the editor open as before, and text typed while ✓'s write was on its way stays in the editor as unsaved.
- The line numbers lost their own fill and now sit on the same surface as the code, a wallpaper or a translucent theme included. When the editor or the source view is unwrapped and scrolled sideways, the code is clipped where it passes under a number instead of being covered by a filled number box.
- A numbered code surface keeps one element per line across edits. Typing redraws only the lines it touches: the other lines keep their colours and their numbers, where before the whole file went colourless on the first keystroke and was rebuilt twice per pause.
