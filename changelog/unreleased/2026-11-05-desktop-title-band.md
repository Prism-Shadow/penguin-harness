# The desktop title band is part of the app, with window controls the page draws

- **Date:** 2026-11-05
- **Type:** feature
- **Scope:** `desktop`, `ui`, `web`
- **PR:** [#1501](https://github.com/Prism-Shadow/penguin-harness/pull/1501)

[中文版](2026-11-05-desktop-title-band.zh.md)

The desktop window's top band took the sidebar's colour on every platform and became part of the app: the sidebar toggle, back and forward sit at its left end, and the main panel beside the sidebar is an inset rounded card. On Windows and Linux the system's title bar is gone, and the page draws minimize, maximize and close itself.

## The band and the card

- The sidebar toggle is the same action as the sidebar's fold button. In the desktop window it is the only one: the sidebar and the folded rail no longer carry their own.
- Back and forward move through the window's history and are greyed out when there is no page that way.
- The rest of the band drags the window. Double-clicking it maximizes or restores the window.
- The main panel is a card set in from the band and from the window's right and bottom edges. Its surface, line and radius come from the theme, and the band and the gaps around the card take the sidebar's colour.
- In a browser the Web App looks as it did: no band and no card, and the fold button stays in the sidebar.

## Per platform

- macOS keeps its traffic lights, and the band's controls start after them.
- On Windows and Linux the window uses `titleBarStyle: "hidden"` with no `titleBarOverlay`. The page draws minimize, maximize (restore once maximized) and close at the band's right end, using the theme's glyphs. Every icon set gained two drawings for them, `square` and `squareStack`. Hovering a button fills it with the theme's wash, and close turns to the danger tone.
- Windows 11's snap layouts flyout, which opened from the system's maximize button, went with that button. Win+Z still opens them.

## The bridge and the fallback

- The main window gained a preload. It runs with context isolation and `sandbox: true`, and exposes `window.penguinWindow` with `minimize`, `toggleMaximize`, `close`, `isMaximized`, `onMaximizedChange`, `platform` and `bandHeight`, and nothing else. The main process accepts these messages only from the main window's own page. Preview windows, detached terminals and built-in browser tabs get no preload.
- The page reads the band's height from one CSS variable, `--window-band-height`. On macOS it comes from the Window Controls Overlay, on Windows and Linux from the bridge, and in a browser it is zero. Every overlay pinned to the window's top reads the same variable.
- The shell injects a fallback band into every page whose root lacks `data-window-controls`: an older server's Web App in attach mode, or any other page. The fallback moves the body down, adds a strip that drags the window, and on Windows and Linux adds three plain window buttons. It replaced the earlier fallback stylesheet.
- The code that passed the page's theme colour to `setTitleBarOverlay` for the overlay's symbol colour was removed. The `theme-color` meta tag stays for phone browsers.
- The menu bar, F10, the menu accelerators and the command palette are unchanged.
