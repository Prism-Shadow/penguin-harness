# Drag the sidebar's edge to change its width

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `web`, `ui`

[中文版](2026-11-19-sidebar-resize.zh.md)

The pinned sidebar's right edge is a resize handle, the same one the docks use: drag it and the sidebar follows the pointer while the page beside it gives way.

## Details

- The width stays between 240 and 480 px, and at most 40% of the window. On a narrower window the sidebar shows at that ceiling and the remembered width is kept, so it comes back when the window widens.
- Until it is dragged the sidebar keeps the theme's own width, which follows the theme and the text size. A double click on the handle goes back to it.
- The handle is focusable, and the left and right arrow keys change the width 16 px at a time.
- The width is remembered in this browser, beside the dock's width, and folding the sidebar to its rail and back keeps it.
- The phone's drawer has no handle. The shared `AppShell` takes the width as `navResize`, and the component gallery's layout board shows an app window with the handle.
