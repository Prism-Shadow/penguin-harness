# The way back survives a broken page

- **Date:** 2026-10-03
- **Type:** feat
- **Scope:** `web`

[中文版](2026-10-03-web-rescue.zh.md)

A page that throws while rendering, or a module tree that fails to boot, no longer leaves a blank window: the web app shows a rescue panel, and the command palette with the harness history stays reachable, so the harness version can still be rolled back.

- WebApp's root renders inside an error boundary. Its panel shows the error with "Reload", "Reload without contributions" and the harness history, in Chinese and English. A failed `bootWeb()` mounts the same panel.
- The command palette and the harness history moved to `src/rescue/` and mount beside WebApp's tree instead of as a `WebAppModule.layers` contribution (`PaletteModule` is gone). They work over the rescue panel and on the bare routes, and so do the host's commands the palette carries for an admin (install the CLI, check for updates, open DevTools). A mounted page adds palette actions with `usePaletteActions` (`lib/palette-actions.ts`); the full-page workflow route's "Exit full page" uses it.
- Safe mode skips every server contribution — contributed pages, company-mode pages, session surfaces and quick starts alike. It is entered from the panel, from the palette, or by opening the app with `?safe`; it lasts for the tab (sessionStorage) across navigation and reloads, a marker at the bottom of the window shows it, and one click leaves it.
- The palette's default shortcut is now ⇧⌘P / Ctrl+Shift+P (was ⌥⌘P / Ctrl+Alt+P); a binding you set yourself is kept. In Firefox the chord opens a private window before the page sees it, so rebind the palette there. The chord also opens the palette while a dialog is open; every other shortcut stays blocked behind a dialog.
