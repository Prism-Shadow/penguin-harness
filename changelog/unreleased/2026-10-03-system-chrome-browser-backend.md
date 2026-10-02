# Agents can drive your own Chrome

- **Date:** 2026-10-03
- **Type:** feature
- **Scope:** `server`, `web`, `cli`, `browser-extension`, `docs`

[中文版](2026-10-03-system-chrome-browser-backend.zh.md)

The agent browser gained a second backend: the user's own Chrome, driven through a new PenguinHarness Browser extension, beside the desktop app's built-in browser. The Web App on any server can now use browser automation, and the desktop app can switch to Chrome. Agents keep the same `penguin browser` commands on both backends and never choose between them.

## Backends and the link

- The browser has two backends, `builtin` (the desktop shell's `<webview>` guests) and `chrome` (the extension). Each runs the same driver, page scripts and actions over a `BrowserLink`. The shell's link is unchanged; the extension's is a WebSocket carrying the same `desktop-browser-command` / `-reply` / `-event` envelopes.
- The extension link adds the `open-tab`, `close-tab`, `activate-tab` and `ping` commands and the `tab-released` event. A tab the user takes back answers `409` `tab_released`.
- On `chrome`, raw CDP refuses the `Target`, `Browser`, `Storage`, `Fetch`, `Extensions`, `Tethering` and `Security` domains, the `Network` methods that read or change cookies, clear the cache or intercept requests, `DOM.setFileInputFiles` and `Page.setDownloadBehavior` (`403` `cdp_refused`). Import, history and clearing data answer `405` `not_supported`.
- Each user has their own chrome runtime and tab registry, and its events go to that user's channel alone. The registry survives a disconnect and is replaced by what Chrome reports on reconnect.

## The extension

- A new package, `packages/browser-extension`: an MV3 extension named PenguinHarness Browser, built with esbuild. It asks for `debugger`, `tabs`, `tabGroups`, `storage`, `webNavigation` and `alarms`, injects no content script and exposes nothing to pages. The manifest pins its key, so its id is `dodgfhpcbmkjfcbgnoidablfgjjhhmgp` for the release zip and for a later Chrome Web Store listing.
- It drives only the tabs it opens, in a blue tab group named Penguin per window and server, tabs the user adds with the toolbar icon, and the pages those open. Dragging a tab out, closing it, the popup's Release and the debugging bar's Cancel take tabs back. Chrome's own pages, the Web Store and local files are refused.
- The debugger attaches on a tab's first command and detaches after 60 seconds idle, so Chrome's debugging bar goes away when the agent stops. The popup's Pause refuses every command until Resume.
- The options page pairs a server (address and pairing code); the popup shows the connection, adds or releases the current tab, and pauses. Copy is in English and Chinese.
- The release workflow uploads `penguin-browser-extension-<version>.zip` and a version-less `penguin-browser-extension.zip`. The desktop installer does not bundle it.

## Pairing and transport

- `POST /api/builtin-browser/extension/pairings` mints a one-time code for the signed-in user: 43 characters, valid for ten minutes, used once, burned after five wrong attempts, held in memory. A new code replaces the user's previous one.
- The extension trades it at `POST /api/builtin-browser/extension/pair`, outside the cookie gate, with CORS and the Private Network Access preflight for its origin only. The answer carries a token of 32 random bytes; the server stores only its SHA-256 in the new `browser_extensions` table.
- The extension connects to `/api/builtin-browser/extension/ws` with the token in `Sec-WebSocket-Protocol` (`penguin-browser.1`, `token.<token>`) from its own origin; cookies are not read. The server says `hello` first and pings every 20 seconds. Close codes: `4001` replaced by the user's newer connection, `4003` revoked, `4005` protocol mismatch, `4008` ping timeout, `4009` switched off by the admin, `1012` on restart.
- `GET /api/builtin-browser/extension` lists the caller's paired Chromes, and `DELETE /api/builtin-browser/extension/:id` revokes one.
- `browserExtensionsEnabled` in `/api/admin/settings` (default on) is the admin's switch: off closes every extension with `4009` and refuses new connections and codes.

## Choosing a backend

- The backend is a per-user choice, `ui_prefs.browserBackend`, read and written only through `GET` / `PUT /api/builtin-browser/backend`. On the desktop an admin may choose either and starts on the built-in browser; members there, and everyone on any other server, have only Chrome. `PUT /api/me/prefs` refuses the key, and `PUT /backend` and pairing codes refuse the API token (`403` `human_required`).
- A switch while an agent acts answers `409` `action_in_flight`. Switching closes no tabs, and no call falls back from one backend to the other.
- `GET /api/builtin-browser/status` carries the effective `backend` and every backend offered to the caller (`backends`), with the user's Chrome. The `builtin_browser_backend` and `builtin_browser_extension` events tell the user's windows about a switch and a Chrome that connected, disconnected, was replaced or was revoked, and `builtin_browser_tabs` names its backend.
- An agent's call with the admin API token and a `sessionId` acts for the person driving that session: whoever last started a run in it, the scheduler's creator, else the Project owner.

## The Web App

- The dock offers the Browser panel wherever the server offers Chrome, with or without `<webview>`. In Chrome mode the panel lists the agent's tabs in Chrome (**+** opens one, **×** closes one), keeps the address bar, and in place of the page shows **This tab is open in your Chrome** with **Show in Chrome**. It shows the pairing steps when no Chrome is paired, **Chrome is not connected** with **Reconnect help** when it is paired but away, and **Chrome connections are off** when the admin turned them off.
- On the desktop, the panel's menu opens with a **Browser** choice for an admin, **Built-in** or **System Chrome**; below it, a status row with **Connect your Chrome…** or **Manage…**. A switch says so in a notice; one refused while an agent acts says why.
- The **Connect your Chrome** dialog gives the install steps with the zip download, then the server address and the pairing code, each with a copy button. Its **Waiting for Chrome…** becomes **Connected** when the extension connects, and the dialog closes.
- **Settings › Browser** holds the backend choice (desktop), the paired Chromes with name, version, last connection and a connected dot, **Revoke** behind a danger confirmation, and **Connect another Chrome**. **Settings › Chrome extension** holds the admin's **Allow Chrome extension connections** switch, whose turning off asks first.
- A link's menu reads **Open in agent's Chrome tab** in Chrome mode.

## penguin browser and the skill

- `penguin browser status` names the backend on its status line (`status: available · backend: chrome (Chrome 130 on macOS, extension 0.2.13)`) and words the three Chrome reasons in its `note:`. `not_supported` prints what to do instead, and an unavailable browser without a reason prints the server's words.
- Every call sends `PENGUIN_SESSION_ID`, in the body or in the query of a `GET` or `DELETE`, so the server can attribute it.
- The `browser-automation` plugin went to version 2026.10.03.1. Its skill says the browser is the user's choice, what to tell the user when Chrome is not paired, not connected or turned off, that `tab_released` is never retried, and to close the tabs it opened when done; `import` is built-in only.
- The Built-in Browser, CLI Reference, Server API and Skills & Plugins docs gained the Chrome backend: installing the extension, pairing, switching, what the agent can reach, the admin switch and the routes.

## Compatibility

No compatibility code was added; these changes were accepted as they are:

- A new table, `browser_extensions` (migration 13). An older server opening the data root never reads it, so its pairings simply stop connecting until a newer server is back.
- A new preference key, `ui_prefs.browserBackend`, written only through `PUT /api/builtin-browser/backend`. An older server leaves it in the stored preferences untouched.
- `/api/builtin-browser` moved from administrators only to every signed-in user, so a member can pair and drive their own Chrome. The built-in browser, import, history, clearing data and the homepage stay administrators only, and the admin switch turns the Chrome side off.
- `BuiltinBrowserStatus.available` now describes the effective backend rather than the desktop shell, and `builtin_browser_tabs` carries `backend`. The Web App and the CLI that ship with the server read both.
- Copies of the `browser-automation` skill installed earlier keep their old text until the Project takes the update the version bump offers.
