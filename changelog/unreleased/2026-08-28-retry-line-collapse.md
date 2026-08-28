# A retry ladder is one line in the transcript, not one per attempt

- **Date:** 2026-08-28
- **Type:** fix
- **Scope:** `web`

[中文版](2026-08-28-retry-line-collapse.zh.md)

Every retryable request end added its own line, so a request that retried four times left four
of them stacked in the conversation:

```
[重试]连接超时或网络中断，已发起第 1 次重试
[重试]连接超时或网络中断，已发起第 2 次重试
[重试]网络或服务暂时不可用，已发起第 3 次重试
[重试]连接超时或网络中断，已发起第 4 次重试
```

A later attempt now replaces the one before it, so the ladder reads as one line that counts up
to `已发起第 4 次重试`. The count was always in the line, so nothing about how many attempts ran
is lost from the transcript.

## Details

- The collapse is in the chat page's view model (`lib/omni/stream-model.ts`) and nothing else.
  **The Trace is untouched**: it still records every attempt as its own event, and the Trace
  panel builds from those raw events rather than from this model, so the full ladder is still
  readable there. The engine's retry behaviour is unchanged.
- A ladder's attempts climb and its items are adjacent — nothing is pushed between them, since
  the `request_begin` that resends only marks the waiting item. So "the last item is a reconnect"
  is necessary but not sufficient: a request that succeeded pushes nothing, so the next failure's
  item is adjacent to the previous ladder's last one while belonging to a different incident.
  That one restarts at attempt 1, which is what separates the two cases.
- **A ladder that gave up keeps its line.** It carries the final failure and its detail, which is
  the one retry line worth keeping on screen; a later incident opens its own.
- The superseded item's id is kept through the replacement, so the rendered row updates instead
  of remounting and replaying its entry animation as though it were a new failure.
- Traces written before the attempt ordinal existed read as attempt 1 throughout, so they never
  collapse and replay exactly as they always did.

## What the collapse costs

A superseded attempt's *cause* leaves the transcript with it: a ladder whose attempts failed for
different reasons — a timeout, then a network error — shows only the reason it is currently on.
The attempt count survives, and the per-attempt causes remain in the Trace.
