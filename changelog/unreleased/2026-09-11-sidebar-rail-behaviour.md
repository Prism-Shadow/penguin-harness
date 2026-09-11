# The collapsed sidebar animates, labels its icons, and opens the account menu in place

- **Date:** 2026-09-11
- **Type:** feature
- **Scope:** `web`
- **PR:** [#684](https://github.com/Prism-Shadow/penguin-harness/pull/684)

[中文版](2026-09-11-sidebar-rail-behaviour.zh.md)

Four changes to the desktop sidebar and the narrow rail it collapses into.

## Details

- Collapsing and expanding animate the sidebar's width over 200ms instead of snapping. Each
  pane is laid out at its own final width inside the box and clipped by it, so the rail is at
  its resting 48px from the first frame and the pinned sidebar is uncovered left to right.
  Width is the only property the animation touches: a transform or a partial opacity on this
  box would make it a stacking context and trap the menus the sidebar opens. Under
  `prefers-reduced-motion` the width still snaps, as every other animation here does.
- The rail's "last conversation" entry, and the Session the chat page auto-selects when
  `/chat` is opened with none, now pick the conversation with the most recent activity rather
  than the most recent creation time — the conversation the user was last in. The filter is
  unchanged: archived rows and subagent Sessions are still never auto-opened.
- The rail's icons carry a styled tooltip that opens on hover and on keyboard focus, after a
  400ms delay, and closes on blur, Escape, scroll or resize. It replaces the native `title`
  on those entries, which appeared only after about a second, could not be styled, and never
  appeared for a keyboard user. Entries on an update trail keep showing what is waiting.
- The rail's avatar opens the account menu — System settings, the update row, sign out —
  anchored on the rail, instead of expanding the sidebar first. Both avatars now render the
  same menu component and the same-sized tile, so collapsing no longer makes the avatar jump
  in size. Its tooltip reads "User settings"; the signed-in id stays in its accessible name,
  which on a collapsed rail is the only place the id appears.
