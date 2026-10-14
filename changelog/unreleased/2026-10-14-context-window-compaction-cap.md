# Compaction follows the model's window when the Agent allows more

- **Date:** 2026-10-14
- **Type:** feature
- **Scope:** `core`, `web`
- **PR:** [#1121](https://github.com/Prism-Shadow/penguin-harness/pull/1121)

[中文版](2026-10-14-context-window-compaction-cap.zh.md)

When an Agent's `compaction.max_context_length` exceeds the selected model's `context_window`, the threshold actually in force is now capped by the window at runtime. The stored Agent config is left untouched, and the existing "Agent setting above the model window" notice stays advisory.

## Details

- `resolveCompaction` compares the configured threshold against the window-derived cap and only records `compactionOrigin: "capped_by_window"` when the configured value is actually capped, so a checkpoint resumed later inherits the same marker through the same resolver.
- `compaction_begin` trace events carry `compaction_origin` when — and only when — the cap applied, making the effective threshold auditable after the fact.
- The context panel header shows both numbers while capped: the configured setting and the effective threshold, in amber.
