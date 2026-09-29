# A roadmap's room reaches a busy room session, and is relayed only where the organization runs

- **Date:** 2026-09-29
- **Type:** fix
- **Scope:** `plugins`, `server`
- **PR:** [Myriad-Dreamin/penguin-harness#59](https://github.com/Myriad-Dreamin/penguin-harness/pull/59), [Myriad-Dreamin/penguin-harness#60](https://github.com/Myriad-Dreamin/penguin-harness/pull/60)

[中文版](2026-09-29-roadmap-room-delivery.zh.md)

A message in a roadmap's room now reaches a room session that is still working: it goes into the running Task between two steps, instead of queuing until that Task ends. Before, a moderator whose session never ended its opening Task (it waited for the room in a loop of its own) heard nothing more of the room, and a person's question there went unanswered for as long as that loop ran. The room session's first input now also says not to wait for the room, but to end its turn.

A server that holds an organization only as a mirror (the organization runs on another machine) no longer relays its roadmap rooms. Before, such a server, after a restart, found the room sessions missing (they are the other machine's), closed them in its copy of the ledger and opened a second set of its own, which spoke in the same room.

For plugins: `MessagingTaskRunner` has `steer` (input into the running Task; 409 `not_running` when there is none), and `OrgView` has `machineId` (the machine the organization runs on when it is not this server, else `null`). The plugin also runs on a server older than either. There, a missing `machineId` does not stop the relay, and without `steer` every line is started as a Task, as before.
