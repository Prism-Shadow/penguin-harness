# Background completion reports steer into the running task

- **Date:** 2026-08-23
- **Type:** feature
- **Scope:** `core`, `server`, `web`

[中文版](2026-08-23-steered-background-notices.zh.md)

Normalized how `run_in_background` completion reports reach the conversation. When the agent loop is running, the report is injected at the next input-assembly boundary — the same mechanism as mid-run steering — and now records that fact on the wire: the `[background_task_done]` block carries a `delivery: steering` field line, stamped at delivery time. A report delivered while the session sat idle stays a task's own starting input and carries no stamp. The two deliveries are positionally identical in the Trace (both sit between a `request_end` and the next `request_begin`), so the recorded stamp is what lets every render and stats layer tell "inside the same turn" from "an independent turn".

## Details

- Core's Session now queues raw completion events and builds the harness user message at the consuming end: the engine's mid-run drain stamps `delivery: steering`, the host's idle take leaves the field off. `parseBackgroundTaskDoneMessage` reads the field back, and a shared `isSteeredBackgroundNotice` predicate serves every turn-segmentation implementation.
- All four "what is one turn" implementations treat a steered report like steering — inside the current turn, never starting a new one: the chat stream reducer gives it a dedicated `background_notice` item (rendered as the same collapsible completion banner, now in-flow), the conversation outline opens no entry for it, the server's message-window scanner neither cuts a window nor counts a turn at it (`CACHE_VERSION` bumped to 2 — cached page stats recompute on first read), and trace analysis merges the continuation request into the current round on the trajectories page, with the injected message's timestamp excluded from the round's duration. The session-fork cut point applies the same exemption.
- The per-turn statistics row no longer appears mid-task at the injection point: it still arrives exactly once, when the whole task ends. A steered report that continues a task past a wrap-up compaction reopens the continuation's own round, exactly as a steering chip does.
- Reports drained at a run's start ride behind the fresh prompt inside that prompt's turn: the injection forces a continuation only when delivered in the gap between two requests, so a ride-along report can no longer merge the new turn into the previous one. With the same rule, a steering message or steered report delivered right after a completed mid-task compaction now opens the continuation's own round on the trajectories page instead of being folded into the compaction round.
- Idle-delivered reports keep their documented behavior — an independent round on every surface. Their outline entry is now titled by the readable report body instead of the raw marker block, and completion reports (either delivery) no longer enter the composer's input history: they are harness-written, not something the user typed.
- Existing Traces are read unchanged: a report recorded before the stamp existed has no `delivery` field and keeps rendering as an independent round; the extra field line is ignored by older parsers.
