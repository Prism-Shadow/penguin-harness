# A machine whose socket dial failed is dialled again while a tab watches it

- **Date:** 2026-09-30
- **Type:** fix
- **Scope:** `server`

[中文版](2026-09-30-machine-events-redial-a-failed-dial.zh.md)

The event hub now keeps dialling a machine that a tab's aggregate event stream (`GET /api/projects/:projectId/machines/events`) watches, after a socket dial to it fails. Before, one failed dial dropped the hub's subscription to that machine. The tab's stream stayed open on the hub's own heartbeat, so nothing dialled the machine again until the page was reloaded. Its events stopped, and the Machines page read `socket: failed` for as long as that lasted.

- A failed dial, or a stream the machine never opens, is retried on the browser's backoff: 1 s, doubling to at most 30 s. The machine's connection is re-read before each attempt, so a replaced ssh session is followed.
- Once a dial succeeds, the stream resumes from the machine's last event id, as after a silence, and `socket` reads `connected`.
- The same socket failure repeated is logged and filed in the error table once per run, not once per dial.
- A reader of `/server/<machineId>/api/events` is still answered the failure at once. The hub stops dialling once no tab watches the machine.
