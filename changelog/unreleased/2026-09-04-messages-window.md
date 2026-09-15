# The transcript loads as a bounded run of message windows

- **Date:** 2026-09-04
- **Type:** feature
- **Scope:** `web`, `server`
- **PR:** [#619](https://github.com/Prism-Shadow/penguin-harness/pull/619)

[中文版](2026-09-04-messages-window.zh.md)

The chat page no longer holds everything from the live tail up to wherever the reader scrolled. History is fetched in windows sized as a message budget and cut at Tasks — the server's `GET /messages` takes `messages=<n>`, the shortest run of whole Tasks holding at least that many, so no tool call and its output, compaction span or steering group ever splits — and the loaded transcript is one contiguous run of them. Opening a conversation reads one window and backfills a second in the background; scrolling near the top fetches the next older one, with the message being read kept exactly where it was. Past a budget the far end is shed a window at a time: scrolling up sheds the live tail first, and scrolling back down refetches with the new `after=<cursor>` form — never past the tail's start — and re-attaches it there. What is rendered is exactly what is loaded, so a phone's DOM and memory are bounded together; the jump-to-latest button, while the tail is off screen, brings it straight back.

A resync now refetches the live tail from its start cursor rather than by size, so a session that has grown since no longer forces the full read.
