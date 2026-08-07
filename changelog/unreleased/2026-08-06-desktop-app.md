# Desktop app: brand icons, completion notifications, single-user mode, bundled penguin CLI

## App icons

Every platform now shows the penguin brand mark instead of the stock Electron icon: electron-builder converts the committed 1024px PNG (rendered from the brand SVG by `scripts/render-icon.mjs`, which reuses the landing package's Playwright chromium) to icns/ico for macOS/Windows, Linux ships a pre-rendered freedesktop icon set, and the window itself carries the icon on Linux/Windows. No tray is introduced — the "default icon" came from the window/app icons never being configured.

## Task-completion notifications

An agent run finishing while the desktop window is unfocused or hidden now raises a system notification with the Session title; clicking it focuses the window and opens that Session. Implemented renderer-side with the standard Web Notification API over the session list's status transitions (first observations never fire; per-run dedupe with a stale-snapshot cooldown) — no preload and no private IPC, honoring the desktop shell's plain-browser-window design. Active only for desktop-shell sessions (`sessionVia === "desktop"`), so browsers are never permission-prompted; Windows toasts get their AppUserModelID from the shell.

## Single-user desktop mode

The desktop app is now explicitly single-user: under the desktop shell the server rejects user management (`/api/admin/users*`) and Project member routes with `403 desktop_single_user`, and the web app hides the Users menu entry, the admin users page, and the Project members section in desktop mode. Existing users and data are untouched, and normal multi-user servers are unaffected.

## Bundled penguin CLI

The installed desktop app now contains the full CLI, runnable without a system Node installation via launchers that run the app's own Electron runtime as Node (`ELECTRON_RUN_AS_NODE`):

- Linux deb: `/usr/bin/penguin` is created automatically at install (postinst extends electron-builder's stock template; never clobbers a non-symlink file, removed on uninstall only when it points at this app).
- macOS / Windows / AppImage: an "Install 'penguin' Command…" native menu item plus a one-time first-launch offer — macOS symlinks `/usr/local/bin/penguin` (one admin escalation when needed), Windows appends the app's `bin` directory to the user PATH (idempotent, new terminals pick it up), AppImage writes a `~/.local/bin/penguin` wrapper that runs the AppImage itself as Node.
