# Resume the original subagents of a conversation

- **Date:** 2026-11-23
- **Type:** fix
- **Scope:** Session runtime and subagent history
- **PR:** https://github.com/Prism-Shadow/penguin-harness/pull/1735

[中文版](2026-11-23-resume-owned-subagents.zh.md)

After a conversation reopens, previously issued subagent handles can continue their original child Sessions. The Agents panel can read the parent’s child Sessions across Tasks, using a stable cursor. A missing child or unverified handle leaves existing Sessions untouched.
