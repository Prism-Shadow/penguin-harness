# Compaction: tool-first ordering, interrupted compactions fail cleanly, and a collapsed streaming summary

- **Date:** 2026-08-18
- **Type:** fix
- **Scope:** `core`, `server`, `web`, `cli`
- **PR:** [#329](https://github.com/Prism-Shadow/penguin-harness/pull/329)
- **Issue:** [#288](https://github.com/Prism-Shadow/penguin-harness/issues/288), [#290](https://github.com/Prism-Shadow/penguin-harness/issues/290)

[中文版](2026-08-18-compaction-continuity-and-streaming.zh.md)

Two compaction defects were fixed and the compaction row gained a live, collapsed summary. A compaction triggered after a tool call now runs the tools to completion and compacts with their results, inventing nothing synthetic; a compaction the user quit out of is closed as failed when the session next loads, with its half-written draft discarded, so messages sent after a compaction survive a reload and stale `(unknown tool)` cards are gone; and the summary reaches the Web App as it is written, inside a block that is collapsed by default exactly like a thinking block.

## A compaction triggered after a tool call runs the tools first

The engine reaches its compaction checkpoint only after `runTurn` has returned, which happens once every tool call of the turn has completed — so a compaction that triggers on a turn ending in tool calls never preempts them.

- All of the turn's results ride the compaction request itself, ahead of the compaction Prompt and in their original call order, whatever they carry: a normal result, a `[tool error]`, or a denial.
- A tool waiting on approval or running for minutes only delays the compaction. No clock is running on it, because the compaction request has not been issued yet.
- Nothing synthetic is inserted to close the pending exchange, and the `LLMInterface` is unchanged.
- Manual `/compact` keeps its own semantics: it has no pending turn, so only the Prompt (plus any interruption carry-over it folds in) goes out.

## A compaction the user quit out of is simply a failed compaction

Quitting mid-compaction left a `compaction_begin` with no matching end in the shard. Core's replay tolerated it and appended the follow-up conversation to the same file, but every reader treats messages between the pair as compaction-internal, so everything sent after the compaction vanished on reload; once a later `compaction_end` un-wedged the state mid-Task, tool outputs rendered without their swallowed calls as "(unknown tool)" cards.

- `resumeTrace` reports the unmatched begin, and `resumeSession` closes the span with a `failed` `compaction_end` before any new record lands, leaving the file well-formed for every later reader. It is idempotent and skipped for healthy traces.
- The interrupted compaction's half-written summary is **discarded**, never reconstructed: no `[context_summary]` is injected, the original context stands, and the standing threshold makes the compaction up at the next trigger.
- The Web reducer drops the partial draft from any compaction that did not complete, so a truncated summary is never shown as if it had been adopted.
- The reader-side stale-span heuristics added earlier in this PR were removed along with the scanner cache-version bump: closing the span at load is enough, and the readers stay simple.

## An abandoned compaction ends the run and is made up later

A mid-Task compaction that failed used to leave the loop in an ill-defined state: the run either ended empty-handed right after the compaction, or continued on bare `[tool error]` repair outputs the model had no instruction to act on.

- A failed or aborted mid-Task compaction now ends the run the way any interruption does: the turn's pending state is held as carry-over under the existing committed/not-committed rule ([#85](https://github.com/Prism-Shadow/penguin-harness/issues/85)), an `abort` event closes the run (`compaction failed` for the failure case), and the next message resends that carry-over merged with the user's input — where the still-standing threshold triggers the compaction again.
- At a Task boundary a failed compaction keeps the original context and simply ends the run, as before.

## The compaction summary streams live

The compaction request's raw messages stay Trace-only, with one exception: the summary being generated rides the output stream as ordinary `partial_text` (or the complete `text`, for LLM implementations that stream nothing), positioned between the paired compaction events. No new protocol type is involved, and the Trace is unchanged.

- The Web App's compaction row is **collapsed by default, exactly like a thinking block**: the chevron is present from the start of a summarize compaction, and the summary streams inside the collapsed body (same `md-body` treatment and streaming renderer thinking uses), which the reader expands to watch it being written or to read it afterwards. Tags are stripped by the same lenient extractor core uses, so a summary still mid-stream reads as prose. A history rebuild reads the same text back from the span's recorded assistant output, so a reload shows what the live viewer saw.
- Because the text is an ordinary streamed message, the server's live tail seeds it too: joining or refreshing mid-compaction picks up the summary prefix generated so far instead of starting blank.
- The CLI keeps its one-line compaction progress and prints none of the streamed summary.
