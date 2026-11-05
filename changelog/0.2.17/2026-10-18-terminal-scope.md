# A terminal belongs to the conversation that opened it; the dock's terminal is one panel of tabs

- **Date:** 2026-10-18
- **Type:** fix
- **Scope:** `server`, `web`, `ui`, `docs`
- **PR:** [#1207](https://github.com/Prism-Shadow/penguin-harness/pull/1207)

[中文版](2026-10-18-terminal-scope.zh.md)

A terminal opened in one conversation could be opened from another: a terminal created in a conversation running on a remote machine, once handed off to a separate window, showed up in a local conversation's dock menu and opened there. The dock had guessed ownership from the arrangements stored in the browser, so any live shell no stored arrangement held was offered to every conversation. A terminal now belongs to the conversation that opened it, recorded on the server, and only that conversation lists or opens it. In the dock, the terminal is one “Command-line terminal” panel per conversation, holding the conversation's shells as tabs of its own the way the browser panel holds its pages, and the dock's “Open in new window” is gone.

## Details

- The server records the conversation each terminal is opened for: `POST /api/terminals` takes `sessionId`, every terminal's info carries it (`null` for one opened without it), and `PATCH /api/terminals/:id` files a terminal under another conversation, which the Web App does when a conversation's id self-heals.
- The terminal is a dock panel like the others, “Command-line terminal”, listed in the dock's “+” menu, the empty dock's picker (with the `` Ctrl+` `` keys) and the floating launcher, and it lands in the bottom dock. Before, each shell was a dock tab of its own and the “+” menu's “New terminal” row started another one every time.
- The panel's strip lists the conversation's live shells on the machine it runs on, each with its number and title, including ones opened for it on another device or browser. Its “+” (“New terminal”) starts another shell and shows it, and a tab's × ends that shell after a confirmation. Terminals of other conversations, machines and Projects, and terminals opened through the API, the CLI or the standalone `/terminal` page, are never listed. The strip is the browser panel's, now shared by both panels as `PanelTabs` in the UI package.
- Opening the panel when the conversation has no live shell starts one. When the last shell ends, whether closed with its × or exiting by itself (`exit`), the panel closes, and the dock goes too when that was its last tab. A first shell that fails to start closes the panel after its error toast. `` Ctrl+` `` hides, brings forward or opens the panel, and `` Ctrl+Shift+` `` starts another shell in it. The shell on screen is kept per conversation, across a reload too.
- A new conversation has no terminal until its first message is sent: the draft page does not offer the panel, and `` Ctrl+` `` and `` Ctrl+Shift+` `` do nothing there. The draft page's dock arrangement is kept per Project rather than shared by every Project's new-chat page.
- Dock arrangements stored by earlier versions hold a tab per shell (`terminal:<id>`). Read back, each dock's first one becomes the terminal panel's tab in its place, the shell it showed stays shown, and the others are dropped; a draft's arrangement loses them. Tabs that earlier versions let cross into another conversation therefore go away once, since the panel lists only the conversation's own shells. The reader of the old form is `packages/web/src/features/dock/legacy-terminal-tabs.ts`, to be removed with its one call the next time `penguin.dock.layout` changes shape.
- A list read while this window was starting or refiling a shell is read again instead of being applied.
- A machine on an older build reports no owner for its terminals, so no panel lists them until that machine is updated; they stay reachable on `/terminal?id=`.
- The dock header's “Open in new window” button and its round trip (the terminal handed to a `/terminal` window and pulled back into the dock when that window closed) were removed; dock fullscreen is how a terminal gets large. The standalone `/terminal` page still opens by its address.
- A push of this build to a machine running an older one closes that machine's open terminals rather than adopting them, since the older terminals cannot record an owner.
