# The web-design skill ships the frontend first, bounds long lists and confirms actions with toasts

- **Date:** 2026-09-11
- **Type:** feature
- **Scope:** `plugins`

[中文版](2026-09-11-web-design-skill-tips.zh.md)

The `web-design` skill in the `software-development` plugin gained the generic techniques from the
published Z.ai Code prompt — everything in it that is not tied to that product's own SDK, stack or
image tools. The plugin version moved to `2026.09.11.1`.

## Details

- Before you start: for a full-stack request, build the frontend first against mocked data so the
  user sees the result early, then the backend; when no stack is named, pick one and state it —
  SQLite or `localStorage` for persistence, process memory for caching, no Redis or MySQL a
  one-line request did not ask for.
- Ship complete: mobile-first styles (the phone layout is the base, `min-width` queries add
  columns); semantic landmarks and an `.sr-only` utility alongside `alt` and `aria-label`; after
  each coding pass, read the tail of the dev server log and the browser console and fix every error
  before presenting the page.
- Components: cards in one grid share padding and stretch to equal height; three new recipes —
  a bounded, thin-scrollbar box for any list that can grow, skeleton blocks for regions that load
  (dots and spinners stay for actions), and a toast for confirming user actions, never a browser
  `alert()`.
- Motion: every clickable element has a hover state and `cursor: pointer`.
- Chat layout: deltas stream over SSE or a WebSocket, never polling; loading states name skeletons
  for regions.
