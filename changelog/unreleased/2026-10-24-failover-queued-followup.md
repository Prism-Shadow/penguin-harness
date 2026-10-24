# A queued follow-up no longer keeps a failed Session on its dead model

- **Date:** 2026-10-24
- **Type:** fix
- **Scope:** `core`, `server`
- **PR:** [#TBD](https://github.com/Prism-Shadow/penguin-harness/pull/TBD)

[中文版](2026-10-24-failover-queued-followup.zh.md)

The failover from [#1062](https://github.com/Prism-Shadow/penguin-harness/pull/1062) moved a Session whose last turn died on a transport failure to the next model of the Project's fallback chain. Two orderings left that failover permanently switched off.

- **A queued follow-up hid the failed run's end.** A Session with a follow-up already queued when its run ended (company-mode triggers keep such a queue permanently non-empty) auto-started the queued Task from the run's `finally`, *before* the failover decision ran. That Task cleared the per-run request end the decision reads, so the Session never moved — it retried every turn on the dead model. The run's `finally` now holds the follow-up launcher for a failover-eligible end; the decision queues the move (ahead of the follow-up) and starts the queue itself.
- **The model switch's summary was requested from the dead model.** An in-session switch closes the context with a summarize compaction, which is an ordinary request on the *old* model. When that model was the very thing being fled, the summary never came back and the switch was abandoned, stranding the Session. When the compaction ends on a transport/connection failure (`timeout`, `network`, `connect_failed`) or a 429 (`rate_limited`), the switch now lands on the target without a summary — text carries over, tool outputs and images stay behind — the same shape a discard compaction leaves. A user stop, a dead credential (`auth`) or a definitive rejection (`rejected`) still keeps the Session put; those are not failures a new model would fix.
