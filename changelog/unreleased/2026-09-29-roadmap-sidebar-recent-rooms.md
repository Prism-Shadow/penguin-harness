# The sidebar's roadmaps follow their rooms, and fold like the channels

- **Date:** 2026-09-29
- **Type:** fix
- **Scope:** `web`
- **PR:** [Myriad-Dreamin/penguin-harness#58](https://github.com/Myriad-Dreamin/penguin-harness/pull/58)

[中文版](2026-09-29-roadmap-sidebar-recent-rooms.zh.md)

The sidebar's **ROADMAPS** section now lists every roadmap that has a room and is not shelved, established ones included. Before, it listed only roadmaps still under discussion, so a roadmap disappeared from the sidebar the moment it was established, even while people kept talking in its room. The order is by most recent activity, and a message in the room now counts as activity alongside the roadmap's own ledger. So replying in a roadmap's room moves it to the top at once, without a reload. The room's last message is read with the list, and every new message moves it after that.

Past the first five, the rest fold under **More (n)**. It is the same fold, in the same style, as the channel list's **Archived (n)**; it replaces the "Show n more" / "Show fewer" button. **All roadmaps** sits below it on a row of the same shape.
