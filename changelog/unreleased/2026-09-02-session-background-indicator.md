# The Session list shows which conversations still have background tasks

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`

[中文版](2026-09-02-session-background-indicator.zh.md)

A conversation that has started a dev server or a background subagent now says so in the
sidebar: its row carries a small layered-stack mark beside the usual status glyph, the chat
header counts the same tasks in a small pill, and both follow the server live — the mark
appears when a command is promoted past its yield window or launched in the background,
and leaves the moment the last task ends, without a list refresh.

## Details

- `SessionInfo` gained an optional `backgroundTasks: { processes, subagents }`, read from the
  loaded runtime's in-memory registries — command sessions still running, and subagent
  sessions that hold a `subagent_id` and are mid-round. The field is present only while at
  least one count is non-zero; an unloaded Session and one with nothing running both omit it.
  List rows and the single-session GET carry the same field.
- A new user-level event, `session_background`, is published on `GET /api/events` whenever a
  Session's counts move (a promotion, an exit, a stop, a subagent round starting or settling, a
  release), carrying the counts as they now stand — zeros included — to the Project's owner
  and members, the same audience as `session_state`.
- Core's `Environment` gained a single background-state listener (`setBackgroundStateListener`,
  forwarded by `Session.onBackgroundState`) fed by the background registries' membership
  changes, the exit of a registered command process, and the subagent run-state pings, so a
  host hears everything that changes "what is still running in the background" from one
  subscription.
- The sidebar row draws the mark in the `busy` tone with its count in the tooltip and accessible
  name ("2 background tasks" / 「2 个后台任务」), beside the running / compacting / unread
  glyph rather than instead of it: an idle, read conversation whose dev server is still up
  keeps the mark. The chat header's former "running services" count became this pill; it now
  includes background subagents and reads the row's live figure instead of the process poll,
  and a count change also re-reads the process list at once.
- The Web App, server API and design docs describe the mark, the field and the event.
