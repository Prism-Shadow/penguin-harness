# A built-in browser that you and your agents share

- **Date:** 2026-09-24
- **Type:** feature
- **Scope:** `desktop`, `server`, `web`, `cli`, `plugins`
- **PR:** [#848](https://github.com/Prism-Shadow/penguin-harness/pull/848)

[中文版](2026-09-24-builtin-browser.zh.md)

The desktop app gained a web browser in its dock. People browse in it as in any browser; agents drive the same tabs from their shell with `penguin browser`, taught by the new preinstalled `browser-automation` plugin, and work signed in with the user's own accounts, which can be imported from the browsers already on the machine. The automation — reading a page as simplified HTML, running JavaScript in it and reporting what changed — was adapted from [GenericAgent](https://github.com/lsdefine/genericagent) (MIT), credited in the README and in `THIRD-PARTY-NOTICES.md`.

## The Browser panel

- A dock panel, **Browser**, beside the terminal. There is one set of tabs for the whole app, and every conversation's dock shows it.
- A tab strip (icon, title, close, new tab) and a toolbar: back, forward, reload or stop, and an address bar that opens a URL, opens a bare domain over `https://` and searches anything else with Bing, with suggestions from the browser's history. The toolbar's menu holds **Import from browser…**, **Clear browsing data…**, **Open in system browser** and **Developer tools**.
- While an agent works in a tab, a pulsing ring runs around the page and an icon in the toolbar says so. When the conversation on screen is the one driving the browser, the dock switches to the panel by itself.
- Each tab is an Electron `<webview>` in its own persistent partition, `persist:penguin-browser`, so the browser keeps its sign-ins and site data apart from the app and from the system browser. Pages see a plain Chrome user agent. The tab on screen is laid out at the dock's size; a tab out of sight, and every tab while the dock is closed, stays mounted at the size it was last shown at (1280×800 if never shown), so an agent keeps working in it.
- A page can open at most three tabs every five seconds (pop-ups, `target=_blank`); more are dropped. The browser holds at most 30 tabs, and a new tab beyond them is refused with `too_many_tabs`.
- The panel exists only in the desktop app. The Web App served by `penguin web`, Docker or a remote server does not offer it.

## Automation over the DevTools Protocol

- The desktop shell hosts the guest pages and relays raw Chrome DevTools Protocol commands, the CDP events a command asks for, and cookie writes to them through `webContents.debugger`, and nothing more. It admits a guest only in the browser's partition, on `http`, `https` or `about:blank`, without a preload, Node integration or pop-ups; a page's attempt to open a window becomes a request for a new tab.
- The server's new `builtin-browser` module holds the product logic, delivered with the server: the tab registry, the driver, and the page scripts ported from GenericAgent's `simphtml` — the DOM simplification (hidden, floating and covered elements dropped, attributes trimmed, long lists cut to three items with a `[FAKE ELEMENT] N more items hidden, selector: "…"` hint, the text truncated to a budget) and the change monitor behind an exec (the number of changed elements, the most significant change, and transient text such as toasts).
- Trusted input: a click is a CDP mouse move, press and release at the element's center after scrolling it into view; typing inserts the text through CDP and fires `input` and `change`.
- A dialog the page opens during an exec, click or type is answered so the page does not block: an alert is accepted, and a confirm or a leave-page dialog is dismissed (Electron does not support `prompt()`) unless the call asks to accept it; the result lists each dialog. The tab's Page events are on only while an agent acts, so the user's own dialogs stay the browser's.
- `/api/builtin-browser` serves status and tabs, open, activate, navigate and close, scan, exec, click, type, screenshot, raw CDP, import, history and clearing browsing data, all to administrators only. Without the desktop app it answers `503 browser_unavailable` with the reason: `not_desktop`, `shell_unsupported` or `no_window`.
- The history of the built-in browser is kept in `<data root>/builtin-browser/history.json`, up to the newest 5,000 pages.

## penguin browser

- `status`, `tabs`, `open`, `switch`, `close`, `scan`, `exec`, `click`, `type`, `screenshot`, `cdp`, `import` and `history`, each with `--json` and `--server`, and `--tab` on the commands that act on a page.
- The output is written for a model to read. `scan` prints a one-line tab header, the tab list and a `---` rule before the page. `exec`, `click` and `type` print labelled lines: `status:` and `tab:`, `return:`, `diff:` with the largest change indented beneath, `transients:`, `new tabs:` and `note:`. A return value longer than 8,000 characters is cut with a pointer at `--save`, which writes the whole value to a file and prints its first 170 characters and the file's path.
- An exec script comes from the argument, from `--file`, or from stdin (`-`, or a heredoc when no argument is given).
- `--accept-dialogs` on `exec`, `click` and `type` accepts every dialog, not only alerts. Each answered dialog prints a line, such as `dialog: confirm "Delete this item?" → dismissed (rerun with --accept-dialogs to accept)`.
- An error is one line, `error: <code>: <message>`, with exit code 1. The commands never auto-start a server; with none running they answer `browser_unavailable`. Inside a session they send `PENGUIN_SESSION_ID` with the calls that act on a page.

## The browser-automation plugin

A preinstalled Office Productivity plugin with one skill, `browser-automation`, built on GenericAgent's browser operating notes: check `status`, then open → scan → exec → check the diff; navigate and act in separate calls; `return` explicitly; never guess selectors; use trusted `click` and `type` where scripted events are ignored; upload files through `DataTransfer` or `DOM.setFileInputFiles`. At a sign-in wall it never types a password: it asks the user to sign in in the panel or offers `penguin browser import`. It never orders, pays or changes an account without the user's confirmation. Amazon orders are the worked example (searching, extracting rows as JSON, paging, the other Amazon sites), with further page recipes in its reference files.

## Importing from the system browser

- The profiles of Chrome, Edge, Brave, Arc (macOS), Vivaldi, Opera, Chromium and Firefox are discovered on each platform, named from `Local State` or `profiles.ini`.
- Cookie values are decrypted as each platform stores them: the Keychain's "Safe Storage" password on macOS (the system asks the user to allow it), the fixed or keyring password read with `secret-tool` on Linux, and the DPAPI-wrapped AES-GCM key on Windows, unwrapped through PowerShell with the key on stdin. Chrome's app-bound (`v20`) cookies on Windows cannot be read by another program; they are skipped with a warning. The SHA-256 host prefix of store version 24 is checked and removed. Firefox's cookies are read as stored, except those kept for a container or partitioned to another site.
- An import can be limited to some sites (`amazon.com` keeps `.amazon.com` and `www.amazon.com`), and it reads only: each store is copied to a temporary directory, with its write-ahead log, read there and deleted. Warnings give counts, never values.
- Imported history merges into the built-in browser's, adding up visit counts.

## Documentation

A Built-in Browser page in the docs, a `penguin browser` section in the CLI reference, the plugin in the Skills & Plugins library tables, the READMEs' plugin tables and an Acknowledgements section, and a GenericAgent entry with its MIT license in `THIRD-PARTY-NOTICES.md`.
