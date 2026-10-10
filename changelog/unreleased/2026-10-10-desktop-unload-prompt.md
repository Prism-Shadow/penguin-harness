# The desktop window asks before discarding unsaved edits

- **Date:** 2026-10-10
- **Type:** feature
- **Scope:** `desktop`

[中文版](2026-10-10-desktop-unload-prompt.zh.md)

Closing or quitting the desktop app while the Web App held unsaved edits used to cancel the close silently: Electron draws nothing for a page that refuses to unload. The shell now asks.

## Details

- **The question:** when the page holds unsaved edits, closing the window, reloading it, or quitting from the tray or the app menu shows a native box in the Web App's language, with the same words as the in-app prompt: 「放弃未保存的修改？」 with 「放弃修改」 and 「继续编辑」 (English: "Discard unsaved changes?", "Discard changes", "Keep editing"). The window is shown first, so a Quit from the tray asks over a visible window.
- **Keep editing** keeps the window and calls the quit off; the next close of the window is an ordinary one (to the tray, when that is on). **Discard changes** lets the page go and the quit continues.
- **Quit order:** the tray icon is removed and the embedded server is stopped only after every window has closed (`will-quit`), no longer as soon as the quit starts (`before-quit`). A quit the user calls off therefore leaves the tray and the server running.
- Closing to the tray hides the window without unloading it, so it asks nothing.
