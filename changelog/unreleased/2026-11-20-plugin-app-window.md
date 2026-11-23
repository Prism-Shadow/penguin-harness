# A server module's iframe system app opens in the App Center's window

- **Date:** 2026-11-20
- **Type:** feature
- **Scope:** `web`, `docs`
- **PR:** [#1673](https://github.com/Prism-Shadow/penguin-harness/pull/1673)

[中文版](2026-11-20-plugin-app-window.zh.md)

A page a server module contributes through `WebModule.pages`, drawn by an iframe and carrying `app` with a title, is a system app that opens in the App Center's window, the same window as an agent's app: minimize keeps it running, full screen draws it with no window around it, and Close ends it (design: [PRFC-0036](https://github.com/Prism-Shadow/penguin-harness-design/pull/503)). The Web App's own system apps (Models, Plugins, Machines, Cost Center, Evaluation Center) still open as their pages. Nothing in this change is specific to one app.

## Details

- **Window.** The app's tile opens `/apps?app=system_agent/<page key>`. A running one wears the running bar, and its tile's name and hint say it is running. Its title bar is the one an agent's app has.
- **Location inside the app.** The window's address carries `at`, the path and query inside the app. The frame starts there, from its document's fragment (`src#<at>`). The page's `{ type: "penguin:location", at }` message replaces `at` without adding a history entry. When the address moves on its own (Back, Forward, a link or a pasted address), the host sends the page the same message instead of reloading it. An address with no `at`, such as the tile's, brings a running window back where its page is and writes that place into the address.
- **Navigation.** The page's `{ type: "penguin:navigate", to }` takes the viewer to `to`, which must be a same-origin path of the app outside `/api/`. The window is minimized and keeps running, so Back brings it back. A message from another frame or origin, and a navigation asked by a minimized window's page, are ignored.
- **Old addresses.** The page's `path` and every address under it lead into the window, with the rest of the path and the query as `at`, replacing the history entry: `/reports/r1?tab=a` opens `/apps?app=system_agent/reports&at=%2Fr1%3Ftab%3Da`.
- **Full screen.** It is the page `/app/<projectId>/system_agent/<page key>?at=…`, outside the app shell like an agent workbench's full page. It starts at the window's place, keeps `at` current, and its exit ball and the palette's "Exit full page (back to the app window)" return to the window there.
- **Frame context.** Every contributed iframe page's root, in the window, full screen or as a plain page, carries `lang` (`zh-CN` or `en`) and `data-project-id`, kept current beside the theme. The frame no longer paints a fixed white or black background, so the theme's surface shows through.
- **Start page.** The start page draws the counts server modules contribute as `startMetrics` in `GET /api/contributions`, after its own three. Each opens the system app it names: in its window when it opens in one, else at its page. A server that sends no such list shows none.
- **Docs.** The Plugins page has a section on a page in the App Center's window: the address, `at`, the two messages and the frame's context.
