# A conversation on a machine out of reach says which machine and where its reconnect stands

- **Date:** 2026-10-19
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1236](https://github.com/Prism-Shadow/penguin-harness/pull/1236)

[中文版](2026-10-19-machine-offline-chat.zh.md)

Opening a conversation whose machine the server could not reach showed the transport's error in red where the transcript belongs, naming the machine by its internal id and a local SOCKS port. The transcript now says which machine it is, by its alias, and where its link stands, and loads the conversation as soon as the machine is connected again.

## Details

- The headline names the machine and its state: reconnecting, stopped reconnecting, its stored password refused, its server stopped, not connected, or not on this Project's machine list. It is read from the same machines list the Machines page shows.
- While the server is bringing the machine back, or has stopped trying, the Machines page's retry status sits under it: the attempt, the countdown to the next one, and Retry now or Retry, which asks the server to try the machine now. A refused retry is said in a toast and can be pressed again. Otherwise a Retry reads the history again.
- The transport's error is kept under a Technical details fold.
- When the machine is connected again, the history is read again without a press.
- A conversation on this server whose history cannot be read shows the error and a Retry as before.
