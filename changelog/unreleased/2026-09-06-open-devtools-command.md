# DevTools from the command palette

- **Date:** 2026-09-06
- **Type:** feature
- **Scope:** `desktop`, `server`, `web`

[中文版](2026-09-06-open-devtools-command.zh.md)

"Open DevTools" is now a command palette entry (Ctrl/Cmd+P) in the desktop app, beside installing the `penguin` command and checking for updates.

The View menu has always toggled DevTools, and its accelerator (Ctrl+Shift+I, ⌥⌘I on macOS) still works — but the menu bar is hidden on Windows and Linux, so the one way to reach a console error was a shortcut nobody is told about. The palette makes it findable when someone is asked to copy an error out.

It opens as a separate window rather than a docked pane, so the page underneath is not reflowed while its errors are being read, and asking again focuses the window that is already open.

The entry appears only under the desktop shell: it is the host that opens DevTools, over the same `/api/command` relay the other shell actions use, and a plain server offers no host commands at all. In a browser, the browser's own DevTools are the answer.
