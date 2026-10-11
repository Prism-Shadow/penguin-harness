# The server runs a Chrome of its own for agents

- **Date:** 2026-10-04
- **Type:** feature
- **Scope:** `server`, `web`, `cli`, `skills`, `docs`

[中文版](2026-10-04-hosted-chrome.zh.md)

The agent browser gained a third backend, `hosted`: a headless Chrome the server launches and drives on its own machine. A Session on a remote machine now has a browser where its Workspace is — `penguin browser` there opens pages from that machine, its loopback included — and the server offers each tab's picture and takes a viewer's input, so a person can watch the same page and act in it.

## The hosted backend

- `BrowserBackend` gained `hosted`, a third `BrowserLink` implementation beside the shell's and the extension's. The driver, the page scripts, the actions and the tab registry are the ones the other backends use.
- Chrome is launched with `--remote-debugging-pipe`, `--headless=new` and no startup window, on its own profile at `<data root>/builtin-browser/hosted-profile`. CDP travels the pipe, so no debugging port is opened. `--no-sandbox` is never passed. On Linux it also gets `--password-store=basic`: a server has no desktop keyring to answer, and Chrome waiting for one stalled every navigation.
- The server looks for Chrome at the path an administrator set, then under the names `google-chrome`, `google-chrome-stable`, `chromium`, `chromium-browser` and `chrome` on `PATH`, then in the standard install locations of macOS, Windows and Linux. It does not download one.
- Chrome starts with the first command that needs it; `GET /status` and `GET /tabs` do not start it. It is stopped after ten minutes with no tab, and when the server stops. When it exits by itself, commands in flight fail, the tab list empties, and the next command starts it again.
- Two reasons joined `BuiltinBrowserUnavailableReason`: `hosted_no_chrome` (none found) and `hosted_launch_failed` (the one found did not start). The second carries Chrome's own error line as `detail`, in `GET /status` and beside the `reason` of a `503` `browser_unavailable`.
- Each tab opens in a window of its own, and popups become tabs. Outside an agent's action a page's alert or leave-page prompt is accepted and a confirm or prompt dismissed, since nobody could answer it.
- Import, history and clearing data answer `405` `not_supported`, as on `chrome`. Raw CDP refuses only the `Target` domain and a `Page.navigate` off the web, as on `builtin`.

## Who gets it

- `hosted` is offered to administrators only, in `GET /backend`'s `choices` and in `GET /status`'s `backends`; a member choosing it gets `403` `admin_required`.
- An administrator with no saved choice gets, in order: the built-in browser in the desktop app, their own Chrome when they have paired one, `hosted` when the machine has a Chrome, else `chrome`. A saved choice is kept, and no call falls back from one backend to another.
- `GET /status`'s `hosted` entry carries `chrome`: the path found, its version once it has started, and whether it is running.
- `GET` / `PUT /api/builtin-browser/settings` gained `chromePath`: an absolute path to the Chrome to launch, or `null` to look for one. A `PUT` now takes either field or both, and keeps the one left out.

## A tab's picture and input

- `GET /api/builtin-browser/tabs/:id/view` is an event stream: each `frame` event is a base64 JPEG with its width and height, from CDP's screencast. `width` and `height` in the query lay the page out to the viewer's panel.
- The screencast runs only while somebody watches. Frames are passed on at most 15 times a second; each viewer holds at most one unsent frame, a newer one replacing it; a new viewer gets the latest frame at once. The stream ends when the tab closes or Chrome exits.
- `POST /api/builtin-browser/tabs/:id/input` takes a batch of mouse, wheel, key and text events and the toolbar's back, forward, reload and stop, and applies them with CDP's `Input` domain. Pointer coordinates are given in the frame's pixels and scaled to the page's CSS pixels.
- Both routes are for administrators and for `hosted`; on another backend they answer `405` `not_supported`.

## The Browser panel

- The panel belongs to a server: it shows the browser of the server the conversation's Workspace lives on, this one or a machine, found the way the Files panel finds its machine. The Web App keeps one browser state per server, sends the panel's requests to that server, and puts a machine's `builtin_browser_*` events in that machine's state; they were dropped before. A link in a conversation opens in the same browser.
- A hosted tab's page area is its picture, drawn to fit the panel, with the viewer's mouse, wheel and keyboard sent back to the page. Text from an input method and a paste arrive as inserted text. A drag follows the pointer outside the panel, and whatever is still held is released when the panel loses the keyboard. Mouse moves are folded so that a request carries one position.
- The page is laid out to the panel's size, and again after a resize settles. The picture is watched only while the panel is on screen and the window is shown. When the stream ends while the tab is still open it is opened again after a growing wait, and after the last wait the page area offers **Retry**.
- The tab strip, the address bar and the agent mark and ring are the built-in browser's. Back, forward, reload and stop travel as input to the page. With no tab open the page area says where pages will appear, and no tab is opened just because the panel is shown.
- The menu's **Browser** group acts on the panel's server and lists **Chrome on this machine** where that server offers it. A machine's panel lists neither **System Chrome** nor the Chrome row.
- When the machine has no Chrome, or Chrome did not start, the page area says so, shows the line Chrome printed, says what to do, and offers **Check again** or **Try again**. The panel reads the browser's status when it comes on screen and keeps asking while the browser cannot run.
- Import, clearing data, the homepage, **Open in system browser** and **Developer tools** are not offered for a hosted tab.

## penguin browser and the skill

- `penguin browser status` prints `backend: hosted`, with the Chrome version once it has started (`backend: hosted (Chrome 140.0.7339.16)`), and words the two new reasons in its `note:`, the launch failure with Chrome's error line.
- The `browser-automation` plugin went to version 2026.10.04.1. Its skill says that on `hosted` the browser is on the Workspace's machine, that the user sees and can take over each tab in the Browser panel, to ask the user to sign in there at a sign-in wall, and that `import` is not part of this backend.
- The Built-in Browser doc gained the backend: what it needs, when it is the default, watching and using its tabs, and its limits.

## Compatibility

No compatibility code was added; these changes were accepted as they are:

- `ui_prefs.browserBackend` has a third value, `hosted`. A server older than this change treats it as unknown and uses its own default.
- A server outside the desktop app whose machine has a Chrome now starts an administrator who has paired no Chrome on `hosted` instead of on `chrome`'s pairing steps. Choosing **System Chrome** once restores the earlier behaviour for that administrator.
- `GET /backend`'s `choices` and `GET /status`'s `backends` list `hosted` for administrators, and `builtin_browser_tabs` may name it as its `backend`.
- Copies of the `browser-automation` skill installed earlier keep their old text until the Project takes the update the version bump offers.
