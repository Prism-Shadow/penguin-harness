# Abort marks user interruptions only

- **Date:** 2026-08-25
- **Type:** refactor
- **Scope:** `core`, `server`, `web`, `cli`
- **Breaking:** yes — the engine no longer emits an abort event for LLM or compaction failures; their terminal record is the `request_end` / `compaction_end` already on the stream

[中文版](2026-08-25-abort-marks-user-interruptions-only.zh.md)

The abort event now means exactly one thing: the user interrupted the run. An LLM fatal, an exhausted retry ladder, and a failed mid-task compaction no longer emit one — each failure's terminal record is the event already on the stream: a `request_end` carrying `status`, `error_message` and `attempt` (and no `retry_in_ms` — a non-completed end without a planned retry **is** the run ending), or the `compaction_end` with its status and detail. The abort payload stays `{type, reason}`, and the engine's reason spellings shrink to the user-interruption set (`aborted by user` / `user`, `aborted during reconnect backoff`, `aborted during compaction`).

The frontends render failures from those records instead: the Web gets an error banner off a fatal `request_end` (`[错误]：模型请求错误：…` in Chinese) and settles the retry-hint item as given-up — final error attached — the moment a retryable end announces no retry; the CLI prints the same two lines. Abort banners themselves now only ever say a user interrupted something, localized via `parseAbortReason` — which still decodes the retired failure spellings, so Traces written before this split render unchanged (an interim-build Trace carrying both records is deduplicated to one line).

Behind the scenes: the server's error watcher resolves a pending LLM failure at the next `request_begin` or at run close — composing the record prose from the event fields (`llm request error: …` for fatal, `llm request failed after N retries: …` for exhaustion, the raw detail when a planned retry was cut short by an interrupt) — so error records keep the same text without the abort event; and the goal loop now recognizes a cut-off round by the terminal `request_end` (or a mid-task compaction failure) rather than by an abort, so a dead credential still stops a goal instead of re-firing rounds against it.
