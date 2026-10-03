# Company roadmaps: establishing no longer archives a roadmap

- **Date:** 2026-09-29
- **Type:** fix
- **Scope:** `plugins`, `web`
- **PR:** [Myriad-Dreamin/penguin-harness#21](https://github.com/Myriad-Dreamin/penguin-harness/pull/21)
- **Breaking:** yes — a roadmap no longer has an `archived` field, and `POST …/roadmaps/:n/archive` and `/unarchive` are gone

[中文版](2026-09-29-roadmap-no-archive.zh.md)

A roadmap has three states and nothing beside them: `awaiting_room`, `discussing` and `established`. Establishing a roadmap only marks it established; it no longer archives it as well, and the moderator's first input no longer says "the roadmap is archived". The manual shelf (archive / unarchive) is removed with it.

## Details

- The ledger has no `archived` / `unarchived` lines and a roadmap no `archived` field; an `established` line sets the status only, and a `reopened` line takes it back to `discussing`.
- The relay and the room claim look at the status alone. A room whose channel is archived is still not relayed: that is the channel's own archive, which the plugin only reads. To stop a room's discussion, archive its channel.
- The app's sidebar lists a roadmap while it is discussing and has a room; the `archived` field left the app's roadmap type.
- The plugin's README and the file headers describe the three states.

## Compatibility

- A ledger written by an earlier build needs no change: an `established` line reads as established, and the `archived` field is simply absent.
- An `archived` or `unarchived` line written by an earlier build is skipped and counted, like any line of an unknown kind; the roadmap reads as if it were not there. A discussion shelved that way reads as discussing again and its room is relayed once more. To stop it, archive the room's channel.
- A caller of `POST …/:n/archive` or `/unarchive` gets 404. Nothing in this repository calls them.
