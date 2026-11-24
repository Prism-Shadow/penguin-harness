# Hide internal compaction summaries and drafts in CLI history

- **Date:** 2026-11-23
- **Type:** fix
- **Scope:** `cli`

[中文版](2026-11-23-cli-history-compaction.zh.md)

After a long conversation compacts, `penguin session log` and `penguin chat --resume` no longer print the internal compaction summary as a user prompt or mix the compaction turn's internal prompt, thoughts, tool calls, and draft summary into the conversation transcript.

## Details

- Omitted internal compaction-summary context openings from CLI history replay (with the same guard in live CLI input echoing), matching the Web App.
- Omitted compaction-internal model messages recorded inside a compaction span from CLI history replay per session/subagent origin, keeping normal turns and concurrent subagent activity unaffected.
