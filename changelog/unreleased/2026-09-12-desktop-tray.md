# A tray icon for the desktop shell

- **Date:** 2026-09-12
- **Type:** feature
- **Scope:** `desktop`, `server`, `web`
- **PR:** [#707](https://github.com/Prism-Shadow/penguin-harness/pull/707)
- **Issue:** [#569](https://github.com/Prism-Shadow/penguin-harness/issues/569)

[中文版](2026-09-12-desktop-tray.zh.md)

The desktop app took a place in the system tray — the Windows notification area, the macOS menu bar, the Linux tray — for as long as it runs, and closing the main window came to hide it there by default, leaving the embedded server and its background tasks running with a one-click way back.

## Details

- The icon is rendered from the app's own artwork by `scripts/render-icon.mjs` and committed under `build/tray/`: a 32px colour image (with a 64px `@2x`) for Windows and Linux, and a 16px monochrome template image (with a 32px `@2x`) that the macOS menu bar inverts with its own appearance. `scripts/build-assets.mjs` stages the set into `dist/tray/`, where the shell looks it up relative to the app directory, so a source run and a packaged app read the same layout. The tooltip is the app name, dev suffix included.
- A left click on the icon brings the main window forward: shown when it was hidden, restored when minimized, recreated when it had been closed. A right click — Ctrl+click on macOS — opens the menu: **Open PenguinHarness**; **New Session** and **Models**, which navigate the main window to `/chat` and `/models`; the **Keep running in the tray when the window closes** checkbox; and **Quit**, which exits through the existing graceful server stop.
- The two clicks are what the platform supports: on Linux the menu is attached to the icon itself and the desktop decides which click opens it, while on macOS and Windows a left click shows the window and a right click opens the menu.
- **Keep running in the tray when the window closes** is on by default, and closing the window then only hides it, on all three platforms. Turning it off restores the previous behaviour: on macOS the window closes and the app stays in the Dock, on Windows and Linux the app quits. So does turning the icon off — with nothing in the tray to bring a hidden window back, the close goes through rather than hiding it.
- **Settings › Appearance** gained a **Tray icon** switch, on by default, which turns the icon off and on with no restart: it leaves the tray the moment the switch moves, and comes back the same way. The row appears only in the desktop app's own window; a browser signed into the same server does not get it. The switch reaches the shell over the message channel the client updater already uses (`GET` / `PUT /api/desktop/tray`), so the window stays a plain browser with no IPC bridge of its own.
- Both preferences are stored in `userData/tray.json`; a missing or malformed file reads as on for each of them independently, and a write that fails is logged and nothing more.
- A second launch of the app, and a Dock click on macOS, now surface a window hidden in the tray instead of only focusing or recreating one.
- A platform that cannot host a tray icon — a Linux desktop without a tray, a headless run — logs the failure and continues without one, and closing the window there keeps its previous per-platform behaviour.
- Deliberately not included: a recent-sessions submenu and a running-activity indicator on the icon. Both need the shell to ask the server what is going on, and the relay between them carries nothing but a shutdown token, update status and this one preference.
