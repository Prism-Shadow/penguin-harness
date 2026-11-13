# Request retry notices stay inside the "Running" work group instead of splitting it

- **Date:** 2026-11-13
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1552](https://github.com/Prism-Shadow/penguin-harness/pull/1552)

[中文版](2026-11-13-retry-inside-work-group.zh.md)

When a model request retries during a turn (`[Retrying]: …` and `[Retried]: attempt 2/10 sent (…)`), the retry notice now renders inside the "Running" work group alongside thinking and tool-call steps instead of closing the group and opening a second one after the retry. While the retry waits for its next attempt, the group stays in the "Running" state and keeps its body open so "Retry now" and "Stop retrying" remain reachable; once the turn finishes, the single "Done" group folds the retry line away with the rest of the turn's work. A retry ladder that exhausts its attempts or is stopped (`[Failed]: …`) still renders outside the settled group at the end of the turn so the failure and its `[Retry]` action stay visible.
