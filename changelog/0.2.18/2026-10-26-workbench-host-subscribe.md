# A workbench's handler can follow a Session live

- **Date:** 2026-10-26
- **Type:** feature
- **Scope:** `server`
- **PR:** [#1349](https://github.com/Prism-Shadow/penguin-harness/pull/1349)

[中文版](2026-10-26-workbench-host-subscribe.zh.md)

`WorkbenchHost` gained `subscribe(sessionId, listener)`, which returns an unsubscribe function. From the moment it subscribes, a workbench's handler receives each record a Session of its Project publishes, the same records `GET /api/sessions/:id/amsp` streams, so it no longer has to poll `sessionResult` to learn that a task has ended.

## Details

- A listener receives the AMSP record envelope, typed as `WorkbenchRecord` (`timestamp`, `type`, `payload`, optional `origin`). Partial deltas and subagent records are included; the Web App's server events are not. Nothing is replayed.
- A Session outside the workbench's Project is refused with the same error as the other host calls.
- A listener runs after the record is published, never inside the Session's run loop. One that throws is logged once per subscription and keeps receiving records.
- A main-Session `task_end` (no `origin`) arrives before the Session reads idle, and `sessionResult` answers `running` until it does.
- Calling the unsubscribe function a second time does nothing. Reloading or removing the workbench ends all of its subscriptions, and a subscription whose Session stays idle with nothing published for 30 minutes ends by itself, so a subscription the handler forgets does not hold the Session's stream buffer indefinitely.
- `sessionResult`, `sessionStatus` and polling are unchanged.
- The `.harness/README.md` the server writes into every workbench documents `subscribe`. A workbench written before this change keeps loading; its `.harness/plugin.d.ts` has no `subscribe` until `.harness/` is deleted.
