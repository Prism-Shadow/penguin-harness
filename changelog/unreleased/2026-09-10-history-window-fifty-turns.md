# A conversation opens on its latest 50 turns instead of the whole transcript

- **Date:** 2026-09-10
- **Type:** fix
- **Scope:** `web`, `docs`

[中文版](2026-09-10-history-window-fifty-turns.zh.md)

Opening a conversation in the Web App now fetches its latest 50 turns, and scrolling near the top backfills 50 more at a time. The history window existed already, but its tail size of 200 Tasks covered nearly every real Session, so every open still read, shipped and rendered the whole transcript, tool output included; long agentic Sessions took seconds to open for content nobody was looking at.

## Details

- The initial history window is 50 Tasks (was 200) and each scroll-up backfill fetches 50 (was 100). The window mechanics are unchanged: Task-aligned cuts, reading position held across a prepend, the beginning-of-conversation marker, the click-to-retry row, and turn numbering and header statistics seeded from the server's cumulative values so a windowed load matches a full one.
- The server API docs describe the `tailLimit` / `before`+`limit` window forms and the `page` envelope of `GET /api/sessions/:sessionId/messages`, and the Web App docs describe the 50-turn window.
