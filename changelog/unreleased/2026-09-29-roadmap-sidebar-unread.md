# The sidebar's roadmap rows show unread messages, as channel rows do

- **Date:** 2026-09-29
- **Type:** feature
- **Scope:** `web`

[中文版](2026-09-29-roadmap-sidebar-unread.zh.md)

A row in the sidebar's **ROADMAPS** section now shows its room's unread messages the way a channel row does:

- the unread count at the end of the row;
- the **@me** chip when a message names you;
- the roadmap's name in bold while anything is unread.

The badge follows the room as it happens. A message from someone else in a room you belong to adds to it at once, and your own messages don't count. Reading the room clears it, by the same rule that clears a channel's badge. The counts come from each room's own channel read, taken when the section reads its roadmaps. A room that cannot be read shows no badge.

The badge markup is shared with the channel rows, so the two cannot drift apart.

Not included: roadmap rooms don't count toward the organization's unread totals, and the collapsed rail has no roadmap rows.
