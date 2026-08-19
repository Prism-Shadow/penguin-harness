# Compaction: dangling-span healing, interruption-flow failures, and streamed summaries

- **Date:** 2026-08-18
- **Type:** fix
- **Scope:** `core`, `server`, `web`, `cli`
- **PR:** [#329](https://github.com/Prism-Shadow/penguin-harness/pull/329)
- **Issue:** [#288](https://github.com/Prism-Shadow/penguin-harness/issues/288), [#290](https://github.com/Prism-Shadow/penguin-harness/issues/290)

[中文版](2026-08-18-compaction-continuity-and-streaming.zh.md)

Two compaction defects were fixed and the compaction banner gained live summary text. A compaction span left open by a process death is healed when the session resumes, so messages sent after a compaction survive a reload and stale `(unknown tool)` cards are gone; an abandoned compaction now ends the run through the ordinary interruption flow and is made up at the next trigger; and the summary reaches the Web App as it is written, carried by the span's own text messages rather than a new event type.

## Dangling compaction spans heal on resume

A process death mid-compaction left a `compaction_begin` with no matching end in the shard. Core's replay tolerated the dangle and appended the follow-up conversation to the same file, but every stateless reader treats messages between the pair as compaction-internal, so everything sent after the compaction vanished on reload; once a later `compaction_end` un-wedged the state mid-Task, tool outputs rendered without their swallowed calls as "(unknown tool)" cards.

- `resumeTrace` reports the unmatched begin, and `resumeSession` appends a synthetic aborted `compaction_end` before any new record lands, leaving the file well-formed for every later reader. Healing is idempotent and skipped for healthy traces.
- The readers additionally close a stale span themselves on the unambiguous signals — another `compaction_begin` (spans never nest), an `abort` event (the engine always closes the pair first), and a rotation's `session_meta` — in the Web reducer, the server's window scanner and the Trace analysis pass, keeping traces damaged before the heal readable.
- The server's scanner cache version was bumped (`CACHE_VERSION` 2), so cached `page_stats` records are recomputed under the new boundary rules.

## An abandoned compaction ends the run and is made up later

A mid-Task compaction that failed used to leave the loop in an ill-defined state: the run either ended empty-handed right after the compaction, or continued on bare `[tool error]` repair outputs the model had no instruction to act on.

- A failed or aborted mid-Task compaction now ends the run the way any interruption does: the turn's pending state is held as carry-over under the existing committed/not-committed rule ([#85](https://github.com/Prism-Shadow/penguin-harness/issues/85)), an `abort` event closes the run (`compaction failed` for the failure case), and the next message resends that carry-over merged with the user's input — where the still-standing threshold triggers the compaction again.
- At a Task boundary a failed compaction keeps the original context and simply ends the run, as before.

## The compaction summary streams live

The compaction request's raw messages stay Trace-only, with one exception: the summary being generated rides the output stream as ordinary `partial_text` (or the complete `text`, for LLM implementations that stream nothing), positioned between the paired compaction events. No new protocol type is involved, and the Trace is unchanged.

- The Web App's compaction banner shows the summary being written under its header, tail-clamped and with tags stripped by the same lenient extractor core uses, then folds the full text into an expandable body once the compaction settles. A history rebuild reads the same text back from the span's recorded assistant output, so a reload shows what the live viewer saw.
- Because the text is an ordinary streamed message, the server's live tail seeds it too: joining or refreshing mid-compaction picks up the summary prefix generated so far instead of starting blank.
- The CLI keeps its one-line compaction progress and prints none of the streamed summary.
