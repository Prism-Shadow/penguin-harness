# Compaction: the loop always resumes, traces heal after crashes, and the summary streams live

Fixes #288 (the agent loop stopping after a mid-task compaction, messages vanishing on
refresh, "unknown tool" cards after interruptions) and #290 (the compaction banner showing
nothing while the summary is generated).

## The loop always resumes after an in-run compaction (#288)

A mid-Task compaction used to fold the turn's freshly arrived tool results into the
compaction request itself. Riding an open tool exchange, the model would often keep working
the task instead of summarizing; every such committed-but-unusable response burned a retry
and **absorbed the folded outputs into the old context** (issue #85's carry rule). When the
compaction was finally abandoned, the engine either ended the run empty-handed — the loop
stopped right after the compaction with only a failure banner — or continued with bare
`[tool error]` repair outputs the model had no instruction to act on.

Two changes make the loop always resume:

- **The pending exchange is closed before the compaction request** (the sequencing issue
  #288 asked for). A new optional `LLMInterface.appendExchange` — implemented by
  `GenerativeModel` over AgentHub's history — commits the turn's tool outputs as their own
  completed exchange (closed by a short synthetic assistant reply, non-empty because
  providers reject empty assistant content), and the compaction Prompt then rides alone as
  a fresh user turn. Pairing stays intact, the append never rewrites history (the
  provider's prompt cache survives), and a rejected attempt can no longer absorb the
  outputs. On success the old object is discarded, so the closing reply costs nothing.
  Manual `/compact` keeps the fold: its input is interruption carry-over, which can mix
  flatten text with structured outputs — not a single closeable exchange. LLM
  implementations without `appendExchange` keep the fold too.
- **A failed mid-Task compaction synthesizes a continuation input** when the absorbed
  outputs left nothing task-bearing to send: a `[compaction_failed]` note (model-only,
  never yielded or persisted — the same rule as every synthetic carry-over) rides after any
  repair outputs, so the run continues on the original context instead of ending.

## Dangling compaction spans heal on resume (#288)

A process death mid-compaction (crash, kill, a shutdown that outran the drive) left a
`compaction_begin` with no matching end in the shard. The session resumed fine — core's
replay is dangle-tolerant — and appended the follow-up conversation to the same file, but
every stateless reader (the Web reducer, the server's message-window scanner) treats
messages between the pair as compaction-internal: **everything sent after the compaction
vanished on reload**, and once a later compaction's `compaction_end` un-wedged the state
mid-Task, tool outputs rendered without their swallowed calls as "(unknown tool)" cards.

- `resumeTrace` now reports the unmatched begin, and `resumeSession` appends a synthetic
  aborted `compaction_end` before any new record lands — the file is well-formed for every
  reader from then on. Healing is idempotent and skipped for healthy traces.
- The readers additionally close a stale span themselves on the unambiguous signals —
  another `compaction_begin` (spans never nest), an `abort` event (the engine always closes
  the pair first), and a rotation's `session_meta` — in the Web reducer, the server's
  window scanner (CACHE_VERSION bumped to 2), and the Trace analysis pass, keeping traces
  damaged before the heal readable.

## The compaction summary streams live (#290)

The compaction request's raw messages stay Trace-only, but the text it generates is now
forwarded as a new stream-only `compaction_delta` event between the paired compaction
events. The Web App's compaction banner shows the summary being written under its header
(tail-clamped, tags stripped with the same lenient extractor core uses) and folds the full
text into an expandable body once the compaction settles. Deltas are never written to Trace
(the Writer refuses them structurally); a history rebuild reconstructs the same text from
the compaction span's recorded assistant output, so a reload shows exactly what the live
viewer saw. Servers forward the event like any other stream message; the CLI ignores it.
