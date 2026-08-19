# File summaries wait for the Task to finish

- **Date:** 2026-07-30
- **Type:** fix
- **Scope:** `web`
- **PR:** [#143](https://github.com/Prism-Shadow/penguin-harness/pull/143)

[中文版](2026-07-30-file-summary-task-boundary.zh.md)

The main conversation's file summary no longer appears after an intermediate assistant message while tools and later model turns are still running. It now appears once at the completed Task boundary and scans all assistant text from that Task, so paths mentioned before a tool call are still available in the final summary. Nested agent conversations keep their existing per-message summaries because their embedded stream does not expose the parent view's Task footer. File-existence caching also stops retaining negative results, allowing a later Task to create and surface a path that was previously absent. Existence checks go out in server-sized batches, so a long Task referencing more paths than one files/stat call accepts still gets its summary instead of silently losing it.
