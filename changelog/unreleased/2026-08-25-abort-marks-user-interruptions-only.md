# Abort marks user interruptions only

- **Date:** 2026-08-25
- **Type:** refactor
- **Scope:** `core`, `server`, `web`, `cli`
- **Breaking:** yes — the engine no longer emits an abort event for LLM or compaction failures (their terminal record is the `request_end` / `compaction_end` already on the stream), and error information converges on one `error_code` + `error_message` pair across payloads

[中文版](2026-08-25-abort-marks-user-interruptions-only.zh.md)

The abort event now means exactly one thing: the user interrupted the run. An LLM fatal, an exhausted retry ladder, and a failed mid-task compaction no longer emit one — each failure's terminal record is the event already on the stream: a `request_end` carrying its status and the error pair (and no `retry_in_ms` — a non-completed end without a planned retry **is** the run ending), or the `compaction_end` with its status and detail.

Error information itself converges on one shape, omnimessage's `ErrorInfo`: a machine-readable `error_code` render layers localize from, plus the verbatim `error_message`. It rides on the abort payload (`user_abort` / `backoff_interrupted` / `compaction_interrupted` — the three user-interruption causes), on `request_end` and `compaction_end` (the classified LLM failure: `timeout` / `network` / `malformed` / `auth` / `rejected` / `unsupported` / `invalid_input`, originating as `LLMOutcome.errorCode` — the status answers "retry?", the code says what kind of error), and on `mcp_connect_end` and its per-server results (`connect_failed`; the old `error` field becomes `error_message`). Nothing parses prose any more: `parseAbortReason` is deleted, and a legacy Trace's `reason` text (or `error` field) is simply shown as-is.

The frontends render failures from those records: the Web shows an error banner off a fatal `request_end`, settles the retry hint as given-up (final error attached) the moment a retryable end announces no retry, and words the reconnect cause from the code (`连接超时` vs `响应不完整` vs `网络或服务暂时不可用` — detail the four-value status alone could no longer express); the CLI prints the same lines. The server's error watcher resolves pending LLM failures at the next `request_begin` or at run close, composing the record prose from the event fields, so error-record text is unchanged without the abort. The goal loop and the subagent round report share one `RunCutoffObserver` that recognizes a cut-off run by its terminal `request_end`, a mid-task compaction failure, or an abort — a dead credential still stops a goal instead of re-firing rounds against it, and a failed subagent still reports `failed` to its parent.
