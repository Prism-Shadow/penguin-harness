# The desktop app opened a second window from the command palette

- **Date:** 2026-10-04
- **Type:** feature
- **Scope:** `desktop`, `server`, `web`

[中文版](2026-10-04-desktop-new-window.zh.md)

The desktop app had one window: launching it again only brought that window forward, and nothing in the app opened another.

## Changes

- **New Window:** the command palette lists New Window in a window of the desktop app. Choosing it opens another window on the same app and the same data. The entry is absent when the app is opened in a browser.
- **How it opens:** the page asks the server (`POST /api/desktop/window`, the shell's own session only), the server tells the shell over the existing message port, and the shell opens the window. A page still cannot open a window on the app by itself.
- **The new window:** it follows the rules of a detached terminal window. Closing it closes it — it does not hide to the tray — and it closes by itself when the session ends. The built-in browser is not offered in it: its tabs live in the main window.
- **The main window:** unchanged. It is still the one window that hides to the tray, reloads after a crash and signs back in.
- **An older desktop app with a newer server:** the app ignores the request, and nothing opens.
