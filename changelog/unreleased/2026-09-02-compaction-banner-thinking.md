# The compaction row streams the request's thinking beside its result

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `core`, `web`, `cli`, `docs`
- **PR:** [#582](https://github.com/Prism-Shadow/penguin-harness/pull/582)

[中文版](2026-09-02-compaction-banner-thinking.zh.md)

The Web App's compaction row took the shape of a running work group: the header names the mode and carries the wall time, and while the compaction runs the row is open on two closed sections — the compaction request's thinking and the summary it produced — each with its own wall time, both streaming while the request runs. Once the compaction settles the row closes itself again.

## Details

- Core forwards the compaction request's thinking on the output stream between the paired compaction events, the same way it already forwarded the summary text: `partial_thinking` fragments verbatim, or the complete `thinking` when no fragment carried content, never both. The request keeps the thinking level its model context already had; nothing switches thinking on for it. The Trace is unchanged.
- The Web reducer accumulates that thinking onto the running compaction item (`thinkingText`, with `thinkingStreaming` tracking the open fragment) beside the summary, rebuilds it identically from the span's recorded thinking on history replay, and drops both drafts when a compaction does not complete.
- The compaction row's body became two stacked disclosure rows, **Thinking** (present only once any thinking arrived) and **Result**, both rendered with the thinking block's body and streaming renderer. Each carries its own status icon and wall time in the thinking block's own slot, so a compaction section, a thinking block and the row above them read identically.
- Step rows (compaction, the first-run MCP connect) now follow the work group's expand policy: the row opens while it runs, so its body rows are on screen as they are appended, and closes itself once it settles — the body's own rows never open with it. A manual toggle pins the row, so a finished row the reader opened stays open. The work group's own policy moved from "is this the last segment" to its header's Running/Done state, which closes it on a turn that ends on the group itself. The header keeps its chevron from the start of a summarize compaction, shows a "streaming" hint in its detail slot while the request runs, and ticks the wall time live before settling to the same formatting the run-finished stats line uses. A failed compaction keeps its single-line reason, and a `discard` row stays chevron-less.
- Each section is timed over exactly the window in which it shows itself running: thinking from its first content to the stop that closes its fragment, the result from its first summary text to the compaction's own end. History replay approximates each start with the previous message's time, the convention an ordinary thinking block already uses. A retried compaction concatenates its attempts into one draft, so a start is recorded once and a later stop only extends it — the wall time covers the whole span that produced the text on screen rather than the last attempt alone.
- The CLI prints none of the streamed thinking, as it already printed none of the streamed summary.
- The agent-loop and Web App docs describe the row's new shape.
