# Close a workbench from any page

- **Date:** 2026-11-19
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1623](https://github.com/Prism-Shadow/penguin-harness/pull/1623)

[中文版](2026-11-19-close-workbench-window.zh.md)

The App Center window’s close button returns to the app’s tile, including inside a folder. After moving between lessons in the English workbench, one click closes the entire window. The browser’s Back button can still step through the lessons. Closing a folder and leaving a full page opened from the App Center return the same way, and the keyboard focus goes back to the tile.

## Details

- The return goes to the host's own App Center entry through the browser's Navigation API, skipping the pages the app's frame added. A browser without that API replaces the current entry with the grid or folder instead. Back then passes through the app's pages before it leaves the App Center.
- The open folder is read from the address alone (`?folder=<id>`). The page no longer keeps a second copy of it or listens to browser history beside the router.
