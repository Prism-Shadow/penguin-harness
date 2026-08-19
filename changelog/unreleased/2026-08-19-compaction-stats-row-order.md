# A wrap-up compaction settles the round's stats row before its banner appears

- **Date:** 2026-08-19
- **Type:** fix
- **Scope:** `web`

[中文版](2026-08-19-compaction-stats-row-order.zh.md)

A compaction that runs once a Task's conversation is over now settles that round's stats row as it begins, so its banner is created underneath the row instead of being moved below it afterwards.

## Details

The stats row already ended up above a trailing compaction banner — compaction is its own round, so the row reporting the conversation belongs first — but the row was placed there at task-idle, once the compaction had finished. A compaction request runs against the largest context of the session, so for those seconds the banner sat directly under the reply and then jumped down as the row slid in above it.

- A compaction beginning while a Task is open is treated as wrapping the round up when the turn that just ran produced no tool outputs (the engine's own criterion for a mid-Task compaction) **and** the round's last item is the model's reply. Both signals must agree; either one being unsure keeps the previous placement-at-finalization behavior, which still covers a mid-stream join and a round whose reply never landed as an item.
- A mid-Task compaction is unaffected: the round stays open, and its ledger — including that compaction's tokens — still settles at the end of the Task.
- Steering queued while a wrap-up compaction runs is delivered after it and keeps the Task going; the steering chip opens the continuation's own round, so its reply keeps a footer of its own rather than joining a round that was already settled.
