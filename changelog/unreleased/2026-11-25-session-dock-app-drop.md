# Dropping an app on the conversation it is already beside shows its tab

- **Date:** 2026-11-25
- **Type:** fix
- **Scope:** `web`, `browser-automation`
- **PR:** [#1858](https://github.com/Prism-Shadow/penguin-harness/pull/1858)

[中文版](2026-11-25-session-dock-app-drop.zh.md)

Dragging a running app from the sidebar onto a conversation it was already beside did nothing when the side dock was hidden or showed another tab; the drop now opens the app's tab.

## Details

- A drag whose sidebar row disappeared before the pointer was released no longer left the pages' embedded frames ignoring the pointer.
- The drop preview stopped re-rendering the page area on every pointer move.
- On the desktop app, the built-in browser's page no longer swallowed the drag when it covered the side dock: the outline and the drop now work over the page too. Dragging text or a link from the app into a page is unchanged.
- In a window narrow enough that the two docks merge into the bottom one, dragging an app onto the conversation is no longer offered; the outline used to show a right-hand column the app did not open in. Clicking the app's row still opens it beside the conversation.
