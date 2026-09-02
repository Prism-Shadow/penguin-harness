# Ctrl+W closes the focused terminal

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `web`, `docs`

[中文版](2026-09-02-terminal-close-shortcut.zh.md)

Pressing Ctrl+W inside a terminal closes that terminal — the same thing its tab's × does: a confirmation first, then the shell is ended. It works in the dock's terminal tabs and on the standalone `/terminal` page, where the window then closes itself when the browser allows it (a window opened by the dock's detach); a window reached by address stays open showing the exited shell, with **New shell** one click away. The keystroke never reaches the shell, and only the terminal that has focus sees it — nothing is registered window-wide. The tab's × tooltip names the shortcut.

## Details

- Browsers reserve Ctrl+W for closing the browser tab and may act on it before the page does; the desktop app delivers it to the terminal.
- In the shell, Ctrl+W was readline's delete-previous-word; inside a PenguinHarness terminal it is now the close.
