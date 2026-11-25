# A conversation on an unreachable machine leads to the Machines page

- **Date:** 2026-10-27
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1376](https://github.com/Prism-Shadow/penguin-harness/pull/1376)

[中文版](2026-10-27-machine-away-opens-machines.zh.md)

When a conversation's history could not be read because its machine was not connected, the message area offered, wherever no retry row was shown, a Retry that only read the history again. It now shows a Go to Machines button in every state (reconnecting, stopped reconnecting, stored password refused, server stopped, not connected, or not on the Project's machine list), and the button opens the Machines page. While the server is reconnecting the machine or has stopped trying, the retry row with Retry now, Stop retrying or Retry stays above the button. The history still loads again on its own once the machine is connected, and a failed read for a conversation on this server keeps its Retry.
