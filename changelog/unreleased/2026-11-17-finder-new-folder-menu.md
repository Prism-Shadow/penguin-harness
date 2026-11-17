# Workspace finder: New folder moves to the right-click menu

- **Date:** 2026-11-17
- **Type:** feature
- **Scope:** `web`
- **PR:** [#1589](https://github.com/Prism-Shadow/penguin-harness/pull/1589)

[中文版](2026-11-17-finder-new-folder-menu.zh.md)

The Workspace finder, the dialog every Workspace picker opens, no longer has a New folder button in its toolbar. As in the macOS Finder, New folder is now the first item of the menu that a right-click on the list's empty space opens. That menu acts on the folder on screen.

## Details

- The item opens the same name row as before, with the same checks and the same server refusals.
- The menu key or Shift+F10 on the list opens the same menu when no row is selected, with New folder focused. ⇧⌘N on a Mac, or Ctrl+Shift+N elsewhere, opens the name row directly. Browsers keep that chord for a private window, so the menu shows the chord only in the desktop app.
- A folder's own menu does not offer New folder, as in Finder and Explorer.
- When the folder on screen can't be read, its menu still lists New folder, disabled, with the reason under it. The menu also offers Copy path and Refresh.
- While a folder is loading, New folder is disabled.
