# A compaction without a full summary showed its hand-over in its 压缩完毕 row

- **Date:** 2026-11-26
- **Type:** feature
- **Scope:** `web`
- **PR:** [#1894](https://github.com/Prism-Shadow/penguin-harness/pull/1894)

[中文版](2026-11-26-trace-handover-details.zh.md)

A compaction that completes without a full summary opens the next context with a hand-over instead. That hand-over is either:
- the hand-off note (a `[context_summary]` block), or
- for an in-session model switch, the Trace hand-over (a `[model_switch_from]` block).

The chat had kept that text out of sight. A switch's hand-over showed only as the divider 「模型已切换 · A → B · 经 Trace 交接」 and its hover hint. The hand-over was moved into the compaction row it follows, shown the way a compaction's own details are. The row settled to 压缩完毕 with the degraded mark, which said why there was no summary.

## Details

- **The rule.** One rule covered every case: the text a context opened with after a compaction row that completed without a full summary was that row's hand-over. A full summary's opening joined no row, and the row kept the summary as its 压缩结果.
- **The section.** The row's body is folded by default. A 「交接说明」 (“Hand-off note”) section took the result section's place, listing three things in order:
  - the reason, in the mark's words;
  - the Trace file the note names, when it names one;
  - the note itself, with its tags stripped.

  Long paths wrapped inside the section, and all of it stayed selectable text.
- **Model switches.**
  - The switch's divider kept its label and lost its hover hint.
  - A switch whose current model could not be reached had sent no compaction request and written no compaction pair, so its row was derived from the hand-over. It settled `completed` with no wall time, and the mark's first line read 「原模型不可用，没有请求摘要」 (“The previous model was unavailable, so no summary was requested”).
  - A switch made before the new context completed a turn rewrote the same hand-over at the next file's head. That copy only labelled the later divider 「经 Trace 交接」 and added no row.
- **Live views.** An in-place hand-off note is written to the Trace with the next file and is not on the live stream. A live view therefore showed its section once the transcript was read from history again; a switch's hand-over, which streams with the switch, showed at once.
- **Data.** Everything was derived from records the Trace already held; no record or field was added.
