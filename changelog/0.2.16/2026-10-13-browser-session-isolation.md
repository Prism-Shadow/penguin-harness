# Isolate browser pages by Session and sign-ins by Project

- **Date:** 2026-10-13
- **Type:** fix
- **Scope:** `desktop`, `server`, `web`, `ui-gallery`, `docs`
- **PR:** [#1105](https://github.com/Prism-Shadow/penguin-harness/pull/1105)
- **Breaking:** yes — Projects start with separate browser storage and require signing in again.

[中文版](2026-10-13-browser-session-isolation.zh.md)

Fixed the desktop browser showing the same pages in different Sessions and letting their automation share an active tab.

## Details

- Each Session kept its own tabs and active page. Browser automation listed and operated on that Session's pages, refused other Sessions' tab IDs, and excluded their concurrent opens from script results.
- Popups inherited their opener's Session. Draft pages followed the created Session without reloading, and background pages stayed mounted for continuous playback.
- Sessions in the same Project shared cookies, sign-ins and website storage. Different Projects used separate persistent browser profiles, including for cookie imports and clearing site data.
- The UI Gallery handled Session page transfers with the same browser-unavailable response as its other browser actions.

## Compatibility

Update the desktop app, including its native shell. Sign in again or import cookies separately in each Project. Existing global browser data was retained outside the Project profiles and was not copied into them. Browsing history remained shared across the built-in browser.
