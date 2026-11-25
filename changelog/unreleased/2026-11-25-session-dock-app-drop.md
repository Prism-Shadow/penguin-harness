# Dropping an app on the conversation it is already beside shows its tab

- **Date:** 2026-11-25
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1858](https://github.com/Prism-Shadow/penguin-harness/pull/1858)

[中文版](2026-11-25-session-dock-app-drop.zh.md)

Dragging a running app from the sidebar onto a conversation it was already beside did nothing when the side dock was hidden or showed another tab; the drop now opens the app's tab.

## Details

- A drag whose sidebar row disappeared before the pointer was released no longer left the pages' embedded frames ignoring the pointer.
- The drop preview stopped re-rendering the page area on every pointer move.
