# The session row's scheduled-task mark covers every Agent

- **Date:** 2026-09-16
- **Type:** fix
- **Scope:** `web`, `server`, `docs`
- **PR:** [#743](https://github.com/Prism-Shadow/penguin-harness/pull/743)

[中文版](2026-09-16-schedule-mark-every-agent.zh.md)

The alarm clock a session row wears for a bound task still to fire kept coming and going: the
sidebar read only the current Agent's tasks while the list shows every Agent's Sessions, so
opening a conversation of another Agent took the marks off the rest of the rows and returning put
them back. The server gained a Project-wide listing and the Web App reads it, so every row wears
its mark whatever Agent it belongs to and however the list is grouped.

## Details

- A new route, `GET /api/projects/:projectId/schedules`, answers with a `ProjectSchedulesResponse`:
  every Agent's tasks stamped with the `agentId` that holds each, Agents in id order, and the files
  that failed to parse stamped the same way. Any member may read it, the same rule as the per-Agent
  list.
- The schedules store moved to caching one list per Project instead of one per Agent, and both
  readers — the session rows and the dock's scheduled-tasks panel — read that list. The panel
  narrows it to the open conversation, and its edits, toggles and deletes name the Agent the task
  belongs to.
- The `schedule_fired` / `schedule_queued` events, a regained window focus, a finished conversation
  turn and the panel's poll refresh the Project's list.
- The Server API reference gained the route, and the Web App guide now says the mark is worn
  whichever Agent a conversation belongs to and however the list is grouped, in both languages.
