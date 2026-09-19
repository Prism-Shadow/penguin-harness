# The desktop app never opens a window the user cannot see, and Penguin Go authorization opens its page directly there

- **Date:** 2026-09-18
- **Type:** fix
- **Scope:** `desktop`, `web`
- **PR:** [#788](https://github.com/Prism-Shadow/penguin-harness/pull/788)

[中文版](2026-09-18-desktop-auth-bridge.zh.md)

An HTML file previewed in the Files panel could obtain a hidden window of the desktop app and
script it, invisibly, for as long as its script kept it — its iframe allows popups, the shell is
not told which frame asked, and a window opened from a page shares that page's origin. Two routes
led there: the hidden `about:blank` window the Web App itself opened while Penguin Go
authorization started, which the shell allowed for that purpose; and a `window.open` on a preview
URL with `show=no` in its feature string, which Electron applied to the window the shell allowed
for previews. The shell now refuses every blank window, pins what a page could hide, and the
Web App opens the authorization page directly when it runs inside the shell.

## Desktop

- A request for `about:blank` — `window.open()` with no URL — is refused like any other
  non-web scheme, from the main window as from every window it opened. The main window has no
  window-open exception of its own any more.
- A window the shell does open (the Workspace preview hand-off, a page on the preview host, a
  detached terminal) is always shown, in the taskbar, opaque, focusable and at least 320×240,
  whatever the opening page's `window.open` feature string asked for. It is centered when it
  appears, and the page's own `moveTo` / `resizeTo` is refused, so it cannot be parked off-screen.
- Every other rule stays as it was: `http(s)` and `mailto` links elsewhere go to the system
  browser; everything else on this instance is refused and logged.

## Web App

- In the desktop app's window, the Penguin Go "Authorize" click no longer opens a blank tab
  first. Once the server returns the authorization URL, the page opens it directly and the shell
  hands it to the system browser — Electron has no popup blocker, so the tab a browser needs to
  open inside the click is not needed there. The page tells the desktop window from a browser by
  the renderer (`Electron/` in the user agent), so this holds in attach mode too, where the
  window signs in through the login page like a browser.
- In a browser, including one signed into a desktop-mode server, the flow is unchanged: a blank
  tab opens inside the click and navigates to the authorization page when the URL arrives.
