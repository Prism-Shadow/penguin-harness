# DevTools from the command palette, and from F12

- **Date:** 2026-09-06
- **Type:** feature
- **Scope:** `desktop`, `server`, `web`

[中文版](2026-09-06-open-devtools-command.zh.md)

"Open DevTools" is now a command palette entry (Ctrl/Cmd+P) in the desktop app, beside installing the `penguin` command and checking for updates. **F12** opens it too, and so does Ctrl+Shift+I.

The View menu has always carried DevTools, but the menu bar is hidden on Windows and Linux, so reaching a console error meant knowing a binding nobody is told about — and the menu's own accelerator is not dependable: Chromium offers every key to the page before firing one, so a page that consumes Ctrl+Shift+I keeps it. The shell now takes F12 and Ctrl+Shift+I on `before-input-event`, ahead of the page, the way F10 already reveals the menu bar; the palette entry makes the same action findable without a key at all.

It opens as a separate window rather than a docked pane, so the page underneath is not reflowed while its errors are being read, and asking again focuses the window that is already open.

The entry appears only under the desktop shell: it is the host that opens DevTools, over the same `/api/command` relay the other shell actions use, and a plain server offers no host commands at all. In a browser, the browser's own DevTools are the answer.
