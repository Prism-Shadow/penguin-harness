# The desktop window's main column sits flush, and no corner cuts off its scrollbar

- **Date:** 2026-11-12
- **Type:** fix
- **Scope:** `ui`, `ui-gallery`

[中文版](2026-11-12-desktop-main-column-flush.zh.md)

The desktop app's main window stopped drawing the main column as a card inset under the title band. The card's rounded corners clipped its content, so on every page whose scroller fills the column (the plugins, Agents and models pages, Agent settings, the App Center) they cut off both ends of the scrollbar, and its edge, radius and gaps did not match the sidebar, which lies flat on the band's colour.

## Details

- The main column is framed in the desktop window as in a browser, by the theme's shell tokens (`--ui-shell-gap`, `--ui-shell-radius`; every built-in theme keeps both at zero): it sits flush against the window's right and bottom edges, and a scroller's scrollbar runs whole to the window's corner.
- The title band and the sidebar stay one surface in the sidebar's colour. The main column is ruled off from the band by the same line that rules it off from the sidebar, which now keeps its own column rule in the desktop window too.
- The gallery has a Desktop window surface: the app framed with a stand-in for the desktop shell's window bridge (the frame's new `window=<platform>` param), on the plugins page. A browser check measures, in every theme, that the main column cuts no corner off the page's scrollbar and rules itself off from the band with the sidebar's line.
