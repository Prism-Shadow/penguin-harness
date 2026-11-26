# A model switch handed over by Trace showed its hand-over in a 压缩完毕 row

- **Date:** 2026-11-26
- **Type:** feature
- **Scope:** `web`
- **PR:** [#1894](https://github.com/Prism-Shadow/penguin-harness/pull/1894)

[中文版](2026-11-26-trace-handover-details.zh.md)

Some in-session model switches could not get a summary: either the compaction gave none, or the current model could not be reached. Such a switch handed the history over by its Trace file. In the chat, that hand-over had shown only as the divider 「模型已切换 · A → B · 经 Trace 交接」, with a hover hint. It was moved into a compaction row above the divider, shown the way a compaction's own details are. The row settled to 压缩完毕 with the degraded mark, which said why there was no summary.

## Details

- **Compaction gave no summary.** The hand-over joined the compaction's own degraded row.
- **Current model unreachable.** The switch had sent no compaction request and written no compaction pair, so the row was derived from the hand-over note the next context opened with. It settled `completed` with no wall time, and the mark's first line read 「原模型不可用，没有请求摘要」 (“The previous model was unavailable, so no summary was requested”).
- **The row's body.** The body is folded by default. A 「交接说明」 (“Hand-off note”) section took the result section's place, listing three things in order:
  - the reason, in the mark's words;
  - the Trace file path;
  - the `[model_switch_from]` note itself, with its tags stripped.

  Long paths wrapped inside the section, and all of it stayed selectable text.
- **The divider.** It kept its label and lost its hover hint.
- **A carried-over hand-over.** A switch made before the new context completed a turn rewrote the same note at the next file's head. That copy only labelled the later divider 「经 Trace 交接」 and added no row.
- **Data.** Everything was derived from records the Trace already held; no record or field was added.
