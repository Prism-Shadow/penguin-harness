# A retry ladder is one line in the transcript, not one per attempt

- **Date:** 2026-08-28
- **Type:** fix
- **Scope:** `web`
- **PR:** [#528](https://github.com/Prism-Shadow/penguin-harness/pull/528)

[中文版](2026-08-28-retry-line-collapse.zh.md)

Every retryable request end added its own line, so a request that retried four times left four
of them stacked in the conversation:

```
[Retry] Connection timed out; retry #1 sent
[Retry] Connection timed out; retry #2 sent
[Retry] Network or service temporarily unavailable; retry #3 sent
[Retry] Connection timed out; retry #4 sent
```

A later attempt now replaces the one before it, so the ladder reads as one line that counts up
to `retry #4 sent`. The count was always in the line, so nothing about how many attempts ran is
lost from the transcript.

## Details

- The collapse is in the chat page's view model (`lib/omni/stream-model.ts`) and nothing else.
  **The Trace is untouched**: it still records every attempt as its own event, and the Trace
  panel builds from those raw events rather than from this model, so the full ladder is still
  readable there. The engine's retry behaviour is unchanged.
- A ladder whose failed attempts produced no output collapses; one whose attempts had already
  streamed thinking or text does not, because that content sits between the rungs. Those ladders
  render one line per attempt exactly as before.
- A new incident opens its own line rather than overwriting the previous ladder's: attempts
  climb within one incident and restart at 1 in the next.
- **A ladder that gave up keeps its line.** It carries the final failure and its detail, which is
  the one retry line worth keeping on screen; a later incident opens its own.
- The superseded item's id is kept through the replacement, so the rendered row updates instead
  of remounting and replaying its entry animation as though it were a new failure. The line's
  per-attempt state is reset alongside it, so "retry now" and "give up" stay usable on every
  countdown in the ladder.
- Traces written before the attempt ordinal existed read as attempt 1 throughout, so they never
  collapse and replay exactly as they always did.

## What the collapse costs

A superseded attempt's *cause* leaves the transcript with it: a ladder whose attempts failed for
different reasons — a timeout, then a network error — shows only the reason it is currently on.
The attempt count survives, and the per-attempt causes remain in the Trace.
