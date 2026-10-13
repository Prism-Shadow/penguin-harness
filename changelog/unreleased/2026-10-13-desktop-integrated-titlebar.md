# Desktop: the window's title bar is part of the app

- **Date:** 2026-10-13
- **Type:** feature
- **Scope:** `desktop`, `web`, `ui`
- **PR:** [#1099](https://github.com/Prism-Shadow/penguin-harness/pull/1099)

[中文版](2026-10-13-desktop-integrated-titlebar.zh.md)

The desktop window stopped drawing the system title bar. A band at the top of the Web App took its place, painted in the theme's own colours, with the window controls laid over it: the traffic lights on macOS, minimize / maximize / close on Windows and Linux.

## Details

- The band is the window's drag handle.
- On Windows and Linux the controls have no background of their own, so the band shows through behind them, and so does a dialog's scrim. Their symbols turn light or dark with the app's mode and theme as they change; the page reports its canvas colour in `<meta name="theme-color">`.
- The app shell, the sign-in page, the full-page workflow view and every overlay that reaches the window's top (dialogs, drawers, the bottom sheet, the lightbox, the command palette, toasts, the find bar, Harness history) start below the band. In a browser the band has no height and nothing moves.
- A page that does not lay the band out itself, such as the Web App of an older server reached in attach mode, gets one from the shell: the window can still be dragged, and nothing sits under the controls.
- On Windows and Linux the menu bar that Alt used to reveal went with the system frame: Electron draws none in a window without one. The menu's shortcuts (reload, developer tools, zoom) still work, and Check for Updates… is still in the account menu's App info, but Install 'penguin' Command… has no menu entry on those two platforms any more.
- Preview windows and detached terminal windows keep the system title bar.
