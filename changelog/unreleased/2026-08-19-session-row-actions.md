# Web App: session row actions split between a hover pair and a right-click menu

- **Date:** 2026-08-19
- **Type:** feature
- **Scope:** `web`, `docs`
- **PR:** [#341](https://github.com/Prism-Shadow/penguin-harness/pull/341)

[中文版](2026-08-19-session-row-actions.zh.md)

Hovering a conversation row in the chat sidebar had come to reveal a single ellipsis button, and every action on the row — including archive and delete — sat one click further in, inside its dropdown. The hover affordance went back to what shipped through v0.2.2: archive and delete as direct icon buttons in the row's trailing slot. The rest of the set did not go away; the whole menu, pin and rename included, now opens on right-click.

## The hover pair

- Hovering a row (or reaching it with keyboard focus) swaps the trailing last-active time for archive/unarchive and delete, one click each. Delete keeps its red treatment on hover.
- The slot reserves the pair's width, so rows with no last-active time no longer let the icons overhang the title, and the icons still line up in one column down the list.
- The buttons take pointer events only while they are actually revealed, so the row's right end holds no invisible tap target on a touch screen — where a hover-gated button never becomes visible at all.

## The context menu

- Right-clicking a row opens pin/unpin, rename, archive/unarchive and delete at the pointer. Pin appears only on active-list rows, where it can actually reorder something — the archived, subagent and scheduled folders offer the other three.
- Touch opens the same menu with a press-and-hold (500ms, abandoned if the finger travels more than 10px, and the click the screen replays afterwards no longer opens the conversation), and the keyboard opens it with Shift+F10 against the focused row, anchored to the row's own box rather than to the viewport corner. Neither hover nor a secondary click exists on a touch screen, so the gesture is not the only way in.
- The panel reuses the shared `Dropdown` through a new virtual-anchor mode, so it inherits that primitive's dismissal (Escape through the shared esc-layer stack, outside click, and scroll), its focus handling (opening focuses the first item; Escape hands focus back to the row), and its viewport clamping and flip near an edge. A pointer-anchored panel dismisses on scroll rather than following the trigger it no longer has.
- The browser's own context menu is suppressed inside the row's handler alone: nothing is bound at the document or window level, so right-clicking anywhere else in the app is unchanged.

## List option icons

- The list-options menu's four rows took leading glyphs: a folder for Workspace grouping and the Agent glyph for Agent grouping — the same two the section header's grouping toggle shows, now read from one shared map — plus a clock for most-recent order and up/down arrows for the drag-reordered manual order.
- The glyphs are decorative beside labels that stay, so each row's accessible name is unchanged.
