# Drag the sidebar's groups into your own order

- **Date:** 2026-08-24
- **Type:** feature
- **Scope:** `web`
- **PR:** [#440](https://github.com/Prism-Shadow/penguin-harness/pull/440)

[中文版](2026-08-24-sidebar-group-order.zh.md)

The chat sidebar's groups — the Workspace folders and the Agents — can be dragged into a manual
order, the way the conversation rows inside them already could. The order is kept per Project and
per grouping mode, and it survives a reload.

## Details

- Dragging a group is itself the intent: there is no sort toggle for groups. A Project and mode
  with nothing stored renders exactly the automatic sort it did before — Workspace groups by their
  newest conversation with the merged temporary-workspace group last, Agents in their configured
  order.
- The merged temporary-workspace group drags like any other. Its trailing position remains the
  default; once it has been dragged, the chosen position wins.
- A group with no stored position sorts to the TOP of the list, keeping its automatic order among
  the other unplaced groups, so a Workspace used for the first time or a freshly created Agent does
  not appear at the bottom of a long list.
- The time grouping is excluded: its buckets are last day / last month / earlier, a fixed
  chronological ladder. `group-order.ts` refuses to read or write an order for that mode, so the
  exclusion does not depend on a check at the call site.
- The group order and the conversation-row order are separate arrays under separate storage key
  namespaces (`penguin.groupOrder.<projectId>.<mode>`), so a group drag never disturbs the rows
  inside a group and a row drag never moves a group.
- Group order composes with the existing group pins the way row order composes with the row pins:
  the pinned cluster stays first, and a drop stays inside its own pin partition, so dragging can
  reorder but never pin or unpin.
- The group header is the drag handle and the drop indicator is drawn against the whole group, so
  "below" means after that group and its conversations. Neither costs layout width, and the header
  keeps its actions at phone width.
- The gesture needs a pointer that can drag, so it is offered only where one exists — HTML5
  drag-and-drop never fires from touch. A stored order still applies on a touch device: there is no
  mode to degrade, so a phone renders the arrangement its owner made at a desk.
- A drop splices the dragged group in beside its target within the stored order, over the mode's
  full group list rather than the ten groups the display cap shows. A Workspace group exists only
  once one of its conversations has loaded, so the groups that have not loaded yet keep their
  stored positions rather than being pushed behind the ones on screen.
- Stored keys that match no group are ignored and are never pruned: deciding a group is gone needs
  the mode's complete key set, which the Web App cannot establish — the per-Workspace counts are
  filtered by the "show CLI sessions" preference, and a settled Agent list may be a failed fetch.
  A group that returns under the same key resumes its place. A malformed stored value degrades to
  the automatic sort.
- Manual order applies to the chat sidebar only; the Traces page's Workspace tree is unaffected.
