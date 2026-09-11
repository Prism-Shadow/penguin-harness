# The session row's scheduled-task mark stops flickering and recedes

- **Date:** 2026-09-10
- **Type:** fix
- **Scope:** `web`
- **PR:** [#677](https://github.com/Prism-Shadow/penguin-harness/pull/677)

[中文版](2026-09-10-session-row-schedule-mark.zh.md)

The alarm clock a session row wears while a scheduled task is bound to it blinked in and out
while switching between conversations, and it was drawn in the same amber as the running
hourglass and the pending-approval badge. The schedules store now caches one list per Agent
instead of pointing a single slot at one, and the mark takes the muted ink of the marks it
belongs with.

## Details

- The store keys its list, its error and its in-flight request by project and agent. Moving to
  another Agent no longer throws away the list the previous one had, and a read asked for while
  another Agent's is still out is issued for the Agent that was asked for instead of being
  answered by the older request.
- `refreshSchedules` takes the scope it refreshes. The dock's scheduled-tasks panel names the
  open conversation's Agent on its poll and after every create, edit, toggle and delete; a
  regained focus and the `schedule_fired` / `schedule_queued` events refresh only the scopes a
  mounted reader is showing.
- The session list holds the marks already on screen while an Agent's list has never been read,
  rather than reading "not loaded yet" as "no Session is scheduled".
- The mark moved next to the pin and the messaging-relay glyph, ahead of the live-status glyph,
  and all three take `muted` from the shared tone tokens.
