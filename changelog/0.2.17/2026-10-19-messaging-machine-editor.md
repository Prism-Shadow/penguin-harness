# The messaging editor of a conversation on a machine says where its bot runs, and stays readable while the machine is away

- **Date:** 2026-10-19
- **Type:** feature
- **Scope:** `web`, `ui-gallery`
- **PR:** [#1219](https://github.com/Prism-Shadow/penguin-harness/pull/1219)

[中文版](2026-10-19-messaging-machine-editor.zh.md)

The Remote control panel and dialog of a conversation that lives on a machine now say which machine its bot connects from, keep showing the binding read-only while that machine is out of reach, and check a bot against every server before turning it on, through the account-holders route of [the server entry](2026-10-19-messaging-account-holders.md).

## Details

- For a conversation on a machine, the editor opens on "Connects from" and the machine's ssh alias. The "What binding does" fold adds what that means: the machine opens the connection to the platform itself, so it needs outbound access there and no public URL; a QR login signs in the machine, not this computer; and the bot keeps answering while this app is closed or cut off from the machine, as long as the machine's server runs.
- While the machine is out of reach (reconnecting, stopped reconnecting, sign-in refused, server stopped, not connected), the editor sends it nothing. It shows the binding as last read in this browser, read-only, under a notice naming the machine's state, whether the bot still answers, and the time of that reading; the connection state reads as "Last known status" in muted ink rather than in its live colour. With nothing read before, the notice stands alone. When the machine is back, the editor reads it again and the controls return. A form already read stays on screen when the machine drops, and only its status poll stops.
- The last reading of a machine conversation's binding, the masked view the read route returns, is kept in localStorage under `penguin.machineMessaging.<project>:<machine>:<session>`. Each read, save and switch replaces it, and a reading with nothing saved removes it. Conversations on this server are not kept.
- Turning a bot on first asks this server which servers hold it. When another server does, the switch refuses with a message naming that server, and nothing is sent to the conversation's own server. When some machines could not be asked, the bot is turned on and a line under the controls names those machines with the reason (not connected, needs an update, did not answer). Turning a bot off asks nobody.
- The gallery's mock API answers the account-holders route.
