# Goal budgets count usage from before a mid-round compaction

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `plugins`
- **PR:** [#1355](https://github.com/Prism-Shadow/penguin-harness/pull/1355)

[中文版](2026-10-26-goal-compaction-budget.zh.md)

Goal mode now includes usage recorded before a mid-round context compaction when checking its token budget. It reads the Session's preceding Trace files back to the current round's input, so completed rounds are not charged again. Agents that already have the `goal` plugin installed pick up the fix by updating the plugin.
