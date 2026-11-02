# The Files panel editor's ✓ saves and closes, ✗ discards, and its line numbers stop flickering

- **Date:** 2026-10-29
- **Type:** fix
- **Scope:** `web`, `ui`
- **PR:** [#1389](https://github.com/Prism-Shadow/penguin-harness/pull/1389)

[中文版](2026-10-29-file-editor-buttons.zh.md)

In the Files panel's editor, ✓ and ✗ became a matched pair from one icon family, drawn the same size. ✓ is Save and close: it writes the file at once and returns to the preview, and with nothing changed it just returns. ✗ is Discard changes: it drops the unsaved text and returns to the preview without a second question. The routine "Save file" confirmation is gone from both ✓ and the save shortcut. The shortcut still keeps the editor open.

## Details

- A file changed on disk since it was opened still asks whether to overwrite it. A save that is refused keeps the editor open as before, and text typed while ✓'s write was on its way stays in the editor as unsaved.
- Leaving the editor puts the focus on Edit.
- The line numbers lost their own fill and now sit on the same surface as the code, a wallpaper or a translucent theme included. On a wallpaper they take the secondary text colour. When the editor or the source view is unwrapped, the numbers are one column pinned to the left edge, and code scrolled sideways is clipped under it instead of being covered by a filled number box. The clip restyles one element per scroll step, so long files scroll sideways smoothly. Typing through an input method no longer hides the numbers while a word is composed.
- A numbered code surface keeps one element per line across edits. Typing redraws only the lines it touches: the other lines keep their colours and their numbers, where before the whole file went colourless on the first keystroke and was rebuilt twice per pause.
