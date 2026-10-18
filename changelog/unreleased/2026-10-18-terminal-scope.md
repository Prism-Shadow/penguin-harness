# A terminal belongs to the conversation that opened it, and stays a tab in its dock

- **Date:** 2026-10-18
- **Type:** fix
- **Scope:** `server`, `web`, `docs`
- **PR:** [#PRNUM](https://github.com/Prism-Shadow/penguin-harness/pull/PRNUM)

[中文版](2026-10-18-terminal-scope.zh.md)

A terminal opened in one conversation could be opened from another: a terminal created in a conversation running on a remote machine, once handed off to a separate window, showed up in a local conversation's dock menu and opened there. The dock had guessed ownership from the arrangements stored in the browser, so any live shell no stored arrangement held was offered to every conversation. A terminal now belongs to the conversation that opened it, recorded on the server, and its conversation's dock is the only place it is listed or opened. The dock's “Open in new window” is gone: a terminal stays a tab in its conversation's dock.

## Details

- The server records the conversation each terminal is opened for: `POST /api/terminals` takes `sessionId`, every terminal's info carries it (`null` for one opened without it), and `PATCH /api/terminals/:id` files a terminal under another conversation, which the Web App does when a conversation's id self-heals.
- A conversation's dock lists and opens only its own terminals, on the machine the conversation runs on. The “+” menu's terminal row reads “Command-line terminal” (it read “New terminal”), with the terminal mark, and below it lists this conversation's terminals that are open elsewhere (another device or browser) with no tab here. The empty dock's picker, the floating launcher and `` Ctrl+` `` bring back one of those before starting a new one. Terminals of other conversations, machines and Projects, and terminals opened through the API, the CLI or the standalone `/terminal` page, are never offered.
- A new conversation has no terminal until its first message is sent: the draft page offers no terminal entry, and `` Ctrl+` `` and `` Ctrl+Shift+` `` do nothing there. The draft page's dock arrangement is kept per Project rather than shared by every Project's new-chat page.
- When the terminal list is refreshed, a terminal tab whose shell this conversation does not own is removed from every stored dock arrangement, as a dead shell's tab already was. Tabs that earlier versions let cross into another conversation disappear once, on the first refresh after the update. A list read while this window was creating or refiling a terminal is read again instead of being applied.
- A machine on an older build reports no owner for its terminals: their existing tabs stay where they are, and no menu offers them until that machine is updated.
- The dock header's “Open in new window” button and its round trip (the terminal handed to a `/terminal` window and pulled back into the dock when that window closed) were removed; dock fullscreen is how a terminal gets large. The standalone `/terminal` page still opens by its address.
- A push of this build to a machine running an older one closes that machine's open terminals rather than adopting them, since the older terminals cannot record an owner.
