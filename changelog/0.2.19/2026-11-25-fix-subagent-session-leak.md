# Background subagents outside the backfill window no longer add stray top-level chips

- **Date:** 2026-11-25
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1851](https://github.com/Prism-Shadow/penguin-harness/pull/1851)

[中文版](2026-11-25-fix-subagent-session-leak.zh.md)

Fixed stray top-level `Subagent <id>` chips appearing mid-conversation when a long-running background subagent started outside the 20-task backfill window emitted live updates or was resumed via `input_subagent`.
