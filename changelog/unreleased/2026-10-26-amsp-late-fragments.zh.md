# 跳过历史快照已经包含的迟到片段

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `amsp`
- **PR:** [#1353](https://github.com/Prism-Shadow/penguin-harness/pull/1353)

[English](2026-10-26-amsp-late-fragments.md)

修复了 `SessionReader` 在历史快照返回后，再次交付快照已包含的文字和工具调用片段的问题。快照游标现在也会过滤实时流和重连后迟到的片段。完整记录、新片段，以及事件编号无法比较的记录仍会正常交付。
