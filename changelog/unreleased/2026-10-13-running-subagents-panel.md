# Keep running subagents visible across tasks

- **Date:** 2026-10-13
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1110](https://github.com/Prism-Shadow/penguin-harness/pull/1110)

[中文版](2026-10-13-running-subagents-panel.zh.md)

The agents panel kept earlier running subagents visible when a later task spawned other children. Their nodes still opened their own conversations and showed their original descriptions.

## Details

- A running child kept its place in the default graph alongside the later task's children.
- Selecting a historical subagent chip kept its task-specific graph.
