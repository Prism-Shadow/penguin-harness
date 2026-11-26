# Open an Agent's apps from the sidebar instead of the chat's tabs

- **Date:** 2026-11-20
- **Type:** feature
- **Scope:** `web`, `ui`, `ui-gallery`, `server`
- **PR:** [#1667](https://github.com/Prism-Shadow/penguin-harness/pull/1667)

[中文版](2026-11-20-sidebar-apps.zh.md)

The sidebar gained an **Apps** group under the three nav rows, above the conversations. It listed the apps of the Agent the page worked under: the open conversation's own, on the machine it ran on, else the current Agent. Any other app still running in a window came after them, marked running. A row opened the app in the App Center's window over the main area, and closing or minimizing that window returned to the page the row was clicked on. The workbench tab strip above the chat was removed: the chat page showed the conversation only, and everything that opened a tab opened the window instead.

## Details

- **The group.** A row showed the app's icon and name, with the App Center tile's marks: running, building (it did not open until built, unless it already ran) and failed. It was selected while its window was in front. Its menu held **Open**, **Remove from sidebar** (the Workbenches row's **Show in the sidebar**, for a row that setting listed) and **View in agent settings**. The header folded the group, remembered per browser, and its **Manage apps** opened the Agent's Workbenches sub-page. The group was not shown while the Agent had no app in the sidebar and nothing ran. It read `GET …/workbenches?view=sidebar` again when the Agent changed and on the server's workbench news, and dropped a late answer for an Agent already left. A server older than that listing was read through its full list.
- **The window.** It opened from the sidebar, from the Workbenches row's **Open** and from the full page's exit, as well as from the App Center. A workbench with two pages or more switched between them in the window's title bar. A page's own request to fill the app opened the full page. Close returned to the page the window was opened over, also in a browser without the Navigation API. An app ended when its workbench was gone; one that a list stopped showing kept running, so an app hidden from the App Center but opened from the sidebar survived a visit to the App Center.
- **The full page's exit** returned to the App Center's grid or folder when a tile had opened it, and otherwise to the app's window at the page shown, the app started again. The command palette named it **Exit full screen (back to the app window)**.
- **The App Center tile's menu** gained the checkable **Show in the sidebar**, the same setting as the row's. `AppCenterShortcut.showInSidebar` carried it on every shortcut, and a server that did not report it got no menu row.
- **Removed:** the chat module's `sessionTabs` slot and its contribution, the tab strip and its hook, the frame's version bar (its reload, history and removal stayed on the Workbenches row), and the dock shortcuts' switch back from a tab. A workbench without a page showed its load notice on its Workbenches row instead of above the chat. Workbench manifests kept declaring their pages with `WebModule.sessionTabs`.
- **UI package:** `AppRow`, the app list's row, with a gallery board, and a title bar with a page switcher on the window board.
