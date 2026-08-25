# Drag the models page's provider groups into your own order

- **Date:** 2026-08-25
- **Type:** feature
- **Scope:** `web`
- **PR:** [#467](https://github.com/Prism-Shadow/penguin-harness/pull/467)

[中文版](2026-08-25-model-group-order.zh.md)

The model library's provider groups can be dragged into a manual order, the way the chat
sidebar's groups already could. The order is kept per Project, survives a reload, and the chat
page's model picker follows it.

## Details

- Dragging a group is itself the intent: there is no sort toggle and no pinning. A Project with
  nothing stored renders exactly the built-in catalog order it did before.
- A group with no stored position sorts to the TOP of the page, keeping its catalog order among
  the other unplaced groups, so a provider used for the first time does not appear at the bottom
  of a long page.
- A drop is committed against **every group the library could show**, including the built-in
  groups that hold no models and are therefore not rendered. A provider that gains its first
  model appears at its catalog place instead of arriving at the top as a newcomer.
- The custom group keeps its own rules — always shown when there is no search query, so it can
  host the "add model" entry point — at whatever position the order gives it.
- The group order and the group expansion set are separate arrays under separate storage keys
  (`penguin.modelsGroupOrder.<projectId>` beside `penguin.modelsExpandedGroups.<projectId>`), so
  dragging a group never folds or unfolds one.
- The group header is the drag handle and the drop indicator is drawn against the whole group, so
  "below" means after that group and its model cards. It costs no layout width, and the header
  keeps its up-to-five actions at every width.
- Dragging is refused while a search query is active: the query filters the page to matches, and
  an arrangement made against that subset is not the arrangement of the library.
- The gesture needs a pointer that can drag, so it is offered only where one exists — HTML5
  drag-and-drop never fires from touch. A stored order still applies on a touch device: there is
  no mode to degrade, so a phone renders the arrangement its owner made at a desk.
- The chat page's model picker already mirrored the library page's order; it now reads the same
  stored array, so the two stay in agreement.
- The drag payload carries its own private MIME type, distinct from the sidebar's group drag: the
  sidebar renders alongside the models page, and one shared type would let a group dragged out of
  the conversation list paint a drop line here.
- Stored keys that match no group are ignored and are never pruned; a group that returns under the
  same key resumes its place. A malformed stored value degrades to the catalog order.
