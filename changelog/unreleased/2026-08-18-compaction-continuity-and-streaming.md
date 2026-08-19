# Compaction: mid-Task continuity, dangling-span healing, and streamed summaries

- **Date:** 2026-08-18
- **Type:** fix
- **Scope:** `core`, `server`, `web`
- **PR:** [#329](https://github.com/Prism-Shadow/penguin-harness/pull/329)
- **Issue:** [#288](https://github.com/Prism-Shadow/penguin-harness/issues/288), [#290](https://github.com/Prism-Shadow/penguin-harness/issues/290)

[中文版](2026-08-18-compaction-continuity-and-streaming.zh.md)

Three compaction defects were fixed and the compaction banner gained live summary text. A mid-Task compaction now closes the turn's pending tool exchange before it compacts, so the agent loop resumes afterwards; a compaction span left open by a process death is healed when the session resumes, so messages sent after a compaction survive a reload and stale `(unknown tool)` cards are gone; and the summary reaches the Web App as it is written, through a new `compaction_delta` event.

## The pending exchange is closed before compacting

A mid-Task compaction used to fold the turn's freshly arrived tool results into the compaction request itself. Riding an open tool exchange, the model often kept working the task instead of summarizing, and each such response burned a retry while absorbing the folded outputs into the old context ([#85](https://github.com/Prism-Shadow/penguin-harness/issues/85)'s carry rule). An abandoned compaction then either ended the run empty-handed or continued with bare `[tool error]` repair outputs.

- A new optional `LLMInterface.appendExchange` — implemented by `GenerativeModel` over AgentHub's history — commits the turn's tool outputs as their own completed exchange, closed by a short synthetic assistant reply (non-empty, because providers reject empty assistant content). The compaction Prompt then arrives as a fresh user turn, pairing stays intact, and a rejected attempt can no longer absorb the outputs. The append never rewrites history, so the provider's prompt-cache prefix survives; on success the old object is discarded, so the closing reply costs nothing.
- Manual `/compact` keeps the fold: its input is interruption carry-over, which can mix flatten text with structured outputs rather than one closeable exchange. LLM implementations without `appendExchange` keep the fold too.
- A failed mid-Task compaction synthesizes a continuation input when the absorbed outputs left nothing task-bearing to send — a `[compaction_failed]` note, model-only and never yielded or persisted, riding after any repair outputs — so the run continues on the original context instead of ending.

## Dangling compaction spans heal on resume

A process death mid-compaction left a `compaction_begin` with no matching end in the shard. Core's replay tolerated the dangle and appended the follow-up conversation to the same file, but every stateless reader treats messages between the pair as compaction-internal, so everything sent after the compaction vanished on reload; once a later `compaction_end` un-wedged the state mid-Task, tool outputs rendered without their swallowed calls as "(unknown tool)" cards.

- `resumeTrace` reports the unmatched begin, and `resumeSession` appends a synthetic aborted `compaction_end` before any new record lands, leaving the file well-formed for every later reader. Healing is idempotent and skipped for healthy traces.
- The readers additionally close a stale span themselves on the unambiguous signals — another `compaction_begin` (spans never nest), an `abort` event (the engine always closes the pair first), and a rotation's `session_meta` — in the Web reducer, the server's window scanner and the Trace analysis pass, keeping traces damaged before the heal readable.
- The server's scanner cache version was bumped (`CACHE_VERSION` 2), so cached `page_stats` records are recomputed under the new boundary rules.

## The compaction summary streams live

The compaction request's raw messages stay Trace-only, but the text it generates is forwarded as a new stream-only `compaction_delta` event between the paired compaction events.

- The Web App's compaction banner shows the summary being written under its header, tail-clamped and with tags stripped by the same lenient extractor core uses, then folds the full text into an expandable body once the compaction settles.
- Deltas are never written to Trace — the Writer refuses them structurally — and a history rebuild reconstructs the same text from the compaction span's recorded assistant output, so a reload shows what the live viewer saw.
