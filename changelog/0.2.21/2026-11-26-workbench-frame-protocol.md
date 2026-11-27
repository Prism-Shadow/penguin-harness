# An Agent workbench page keeps its place in the address

- **Date:** 2026-11-26
- **Type:** feature
- **Scope:** `web`, `docs`, `plugins`
- **PR:** [#1898](https://github.com/Prism-Shadow/penguin-harness/pull/1898)

[中文版](2026-11-26-workbench-frame-protocol.zh.md)

Every Agent workbench window and full page took on the location protocol that a server module's iframe system app already had: the `at` position in the address, and the `penguin:location` and `penguin:navigate` messages. Design: penguin-harness-design [#619](https://github.com/Prism-Shadow/penguin-harness-design/pull/619).

## Details

- **Address.** The window `/apps?app=<agentId>/<workbenchId>` takes `&at=<path and query inside the page>`; a machine's app keeps its `<machineId>:` prefix in the key. The full page `/app/<projectId>/<agentId>/<workbenchId>[/<tab>]` takes the same `?at=`.
- **Location.** The frame's `src` carries the starting `at` as its fragment (`#<at>`). A page's `{ type: "penguin:location", at }` replaces `at` in the address without adding a history entry. When the address gains an `at` on its own, through Back, Forward or a pasted address, the host posts the same message to the page and does not reload the frame. An address without `at`, such as the tile or the sidebar, brings a running window back where its page is.
- **Navigate.** A page's `{ type: "penguin:navigate", to }` minimizes the window and takes the viewer to `to`. The host accepts it only when `to` is a same-origin app path (it starts with one `/` and is not under `/api/`) and the message comes from that window's own frame. A minimized window's request is ignored.
- **Full screen.** Opening full screen from the window, from the sidebar row's menu or at the page's own `penguin:fill-app`, opens the full page at the page's place. The full page keeps the page's moves in its own `?at=`, and its exit returns to the window at the place the page has reached.
- **Several pages.** In a workbench of several pages, switching to another page starts that page at its root and takes `at` out of the address.
- **Context.** The workbench frame's root carries `lang` and `data-project-id` on load and on every change, as a contributed page's frame does.
- A workbench that posts neither message behaves as before; `penguin:fill-app` and the model-picker messages are unchanged.
- The window and the full page of a system app and of an Agent workbench now share one implementation of this protocol.
- The `penguin-plugin` Skill (version `2026.11.26.1`) and the docs' Workbench plugins and Plugins pages describe `at` and the two messages for workbench authors.
