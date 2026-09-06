# Desktop: Alt no longer pulls up the menu bar

- **Date:** 2026-09-05
- **Type:** fix
- **Scope:** `desktop`, `server`, `web`
- **PR:** [#625](https://github.com/Prism-Shadow/penguin-harness/pull/625)

[中文版](2026-09-05-desktop-menu-bar.zh.md)

On Windows and Linux the desktop app's menu bar was auto-hidden, so a lone press of Alt pulled it up and handed the keyboard to it — and every Alt combination the page or a terminal wanted (Alt+B, Alt+., Alt+Enter) was eaten on the way. The bar is now hidden outright. Alt does nothing on its own, the application menu's shortcuts still work, and F10 shows the bar for the rare time it is wanted. macOS, whose menu lives in the system bar, is unchanged.

## Details

- The menu's own actions — **Install 'penguin' command…** and **Check for desktop updates…** — are offered from the command palette (Ctrl+P) to an admin, in any window signed into the desktop app's server. **Project on GitHub** is in the palette everywhere.
- The palette reaches the shell through the server, over the same channel the update relay uses: `GET /api/command` lists the commands this host offers (none under a plain server), `POST /api/command/:command` runs one. Admin only; not limited to the shell's own window, since a command acts on the host, not on the window.
- Preview windows opened from the app have their menu bar hidden the same way.
