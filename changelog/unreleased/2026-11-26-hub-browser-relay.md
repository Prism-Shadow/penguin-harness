# A conversation on a remote machine uses the person's own browser

- **Date:** 2026-11-26
- **Type:** feature
- **Scope:** `browser-automation`, `server`, `web`

[中文版](2026-11-26-hub-browser-relay.zh.md)

A conversation that runs on a remote machine now has a browser: the one the person uses on this server. In the desktop app that is the built-in browser, or their paired Chrome when they chose it. Its panel lists the conversation's pages and lets you open, use and close them, as for a conversation on this computer. The machine's agents drive the same pages, and the panel shows them at work.

## How it works

- This server keeps a channel to every machine its admin's Projects use while the machine is connected. The channel runs through the ssh connection this server already holds, and the person's browser is relayed over it. When the admin switches between the built-in browser and their Chrome, the channel is reopened, and the machine's agents follow.
- The pages belong to the machine's conversation (with its machine), in that conversation's Project partition. A popup of such a page belongs to the same conversation.
- The panel of a conversation on a machine opens its pages here (`POST /api/builtin-browser/tabs` with `machineId`). The machine vouches for the conversation first.
- The machine's agents can reach only their own pages, in Projects that use the machine. Raw CDP that reaches the person's cookies or stores, a navigation to anything but a web page, and cookie and data commands are refused here. Network events are not passed on.
- When this server's browser cannot be driven, the machine's agents get the same reason the person would (for example `extension_not_paired`). When this server is not connected, `penguin browser status` on the machine says to keep PenguinHarness open on the computer the machine was added from and the machine connected.
- A machine whose version has no channel is not asked again until it reconnects; its conversations stay without a browser.
- The interim notice that a conversation on a machine has no browser is gone.
