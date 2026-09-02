# The compaction row streams the request's thinking beside its result

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `core`, `web`, `cli`, `docs`

[中文版](2026-09-02-compaction-banner-thinking.zh.md)

The Web App's compaction row took the shape of a finished work group: the header names the mode and carries the wall time, and its collapsed body holds two sections — the compaction request's thinking and the summary it produced — both streaming while the request runs.

## Details

- Core forwards the compaction request's thinking on the output stream between the paired compaction events, the same way it already forwarded the summary text: `partial_thinking` fragments verbatim, or the complete `thinking` when no fragment carried content, never both. The request keeps the thinking level its model context already had; nothing switches thinking on for it. The Trace is unchanged.
- The Web reducer accumulates that thinking onto the running compaction item (`thinkingText`, with `thinkingStreaming` tracking the open fragment) beside the summary, rebuilds it identically from the span's recorded thinking on history replay, and drops both drafts when a compaction does not complete.
- The compaction row's body became two stacked disclosure rows, each collapsed by default like a thinking block: **Thinking** (present only once any thinking arrived) and **Result**, both rendered with the thinking block's body and streaming renderer. The header keeps its chevron from the start of a summarize compaction, shows a "streaming" hint in its detail slot while the request runs, and ticks the wall time live before settling to the same formatting the run-finished stats line uses. A failed compaction keeps its single-line reason, and a `discard` row stays chevron-less.
- The CLI prints none of the streamed thinking, as it already printed none of the streamed summary.
- The agent-loop and Web App docs describe the row's new shape.
