# A running subagent Session opened from the Agent panel stays running, with its live stream

- **Date:** 2026-11-25
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1852](https://github.com/Prism-Shadow/penguin-harness/pull/1852)

[中文版](2026-11-25-fix-agent-panel-jump-running-status.zh.md)

Fixed jumping to a running subagent Session from the Agent panel wrongly displaying the conversation as finished (`idle`), and enabled live streaming, tool approvals, steering, and stop controls directly on the child Session view while it is hosted by a parent Session.
