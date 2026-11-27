# Closing a dock's last tab leaves it open on a start page

- **Date:** 2026-11-27
- **Type:** feature
- **Scope:** `web`, `ui`, `ui-gallery`

[中文版](2026-11-27-dock-start-page.zh.md)

Closing the last tab in a conversation's dock no longer put the dock away. The dock stayed where it was, at the same size, and showed its start page: everything its "+" menu offers, in the same order, as App Center tiles. The empty dock that the toolbar buttons pull open showed the same page, which replaced the old list of panels.

## Details

- The start page's tiles did exactly what the matching "+" rows do. In a conversation's right dock, and on the merged surface on narrow screens, that list was the conversation's Shortcuts: App Center first, then the panels, each opened as the conversation's Session tool. The bottom dock listed the panels it offers. Terminal, Files and Browser used their App Center icons. A panel with a keyboard shortcut showed it in the tile's hover hint.
- In the right dock and in full screen, each tile showed the icon above the name, and the number of columns followed the dock's width, keeping rows as even as possible. The bottom dock and the narrow merged surface showed rows with the icon beside the name. Arrow keys moved between tiles, and Enter opened one.
- After the last tab closed, the start page faded in. If focus had been on the tab's ×, it moved to the first tile. Focus elsewhere, such as in the composer, stayed put. A dock in full screen stayed in full screen.
- Only the dock's own controls put it away: its ×, the toolbar button, the keyboard shortcut, and Ctrl+` on the terminal it shows. A dock whose tabs moved away (to the other edge, or with an app moved beside another conversation) still closed. A Session tool that had stood in for a panel already in the conversation's layout put that layout back as it was when it closed.
- The App Center's tiles and the start page shared a new `LaunchTile` / `LaunchGrid` in the UI package, shown in the gallery's Layout board. `DockModule.panels`' `lead` no longer ordered anything.
