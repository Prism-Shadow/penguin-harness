# Files, the app shell and the dock move into the shared UI package

- **Date:** 2026-09-30
- **Type:** refactor
- **Scope:** `ui`, `web`, `ui-gallery`

[中文版](2026-09-30-ui-migration-w7.zh.md)

W7 of the UI-package migration lifts the app's frame into `@prismshadow/penguin-ui`: the Files panel, the window with its sidebar and rail, and the dock. The containers keep their paths and their behaviour in the Web App.

## What moved

- **Files:** `FileTree`, `FileBrowser`, the file menu's rows, the in-place editor, and the Files panel's `TreePane`, `PreviewPane`, `DropOverlay` and `Breadcrumbs`. The pointer drag moves too, with the new `ResizeHandle` and `SplitPane`, which now carry the Files panel's split and both dock resizers.
- **Shell:** `AppShell`, `Rail`, `MobileTopBar`, `SidebarFrame` and `SessionRow`. The sidebar's page links are `NavRow`s, and a conversation's menu rows are `MenuItem`s.
- **Dock:** `DockFrame`, `DockTabs`, `DockPicker`, `PanelsToolbar`, and the floating launcher's `LauncherBall` and `LauncherFan`.

## Details

- The terminal's own light/dark palette stays in the Web App: it sits outside the token system by design.
- The launcher keeps its sizes. Its caption stays 13 px and now follows the text-size setting.
- The dock's tabs are a proper tab list (`role="tab"`).
- The nav column's hover and selected fills are washes of the text colour, and company mode's channel, desk and Temporary rows use them too.

## Visible changes in the default theme (Primer)

- **Sidebar and rails:**
  - Page links in the sidebar are one step lighter at rest (gray-600 → gray-500) and truncate instead of wrapping.
  - Rows sit 1 px closer.
  - A conversation's time is 12 px.
- **Files panel:**
  - Its split handle takes the info tone.
  - The floating pill and the chat drop veil lose their blur.
  - File sizes and the truncation note are 12 px.
- **Dock:**
  - Its handles use the same info tone.
  - The picker's shortcuts are key caps.
  - The bottom handle's cursor is `row-resize`.
  - On touch, the maximise button draws the registry's corner brackets, one pixel further out than before.
- **Dark mode:** the nav column's fill is the muted surface (#1a1a1a → #202020).
