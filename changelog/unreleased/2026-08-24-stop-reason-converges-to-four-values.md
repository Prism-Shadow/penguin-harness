# Stop reasons converge to four values

- **Date:** 2026-08-24
- **Type:** refactor
- **Scope:** `core`, `server`, `web`, `cli`
- **Breaking:** yes — `StopReason` drops `failed` / `timeout` / `malformed` / `auth` in favor of `retryable` / `fatal`; `LLMOutcome.permanent` is removed; the Web composer's auth-dead gate is retired

[中文版](2026-08-24-stop-reason-converges-to-four-values.zh.md)

The LLM stop-reason protocol converged from six values to four: `completed` / `aborted` / `retryable` / `fatal`. A stop reason now answers exactly one question — should this request be retried — and the concrete failure rides on `error_message` (`LLMOutcome.errorMessage` → `request_end.error_message`) instead of on the reason value.

**`retryable`** covers everything worth another attempt: transport drops, idle timeouts, 408/429/5xx, malformed or truncated responses, and every unclassifiable error — the fatal detector is a deterministic allowlist, so a gateway phrasing a transient fault its own way keeps its retries. The engine reconnects on the existing backoff ladder, unchanged.

**`fatal`** covers what no retry can fix: a provider 4xx rejection (408/429 excluded), a credentials failure, fast mode on a model without a fast tier, and input that fails to assemble into a request. The engine stops the run and surfaces the message at once. Previously a deterministic 400 was classified `failed` and burned the whole five-step ladder before the user saw the actionable error — the direct motivation, uncovered while diagnosing the Vertex mixed-content 400.

## Details

- `LLMOutcome.permanent` is gone: `fatal` is the classification, not a flag on a classification. The engine's fatal branch replaces the former `auth` and permanent-failed branches.
- The dedicated `auth` status is gone, and with it the Web composer's auth-dead input gate (the time-gated lock cleared by `credentials_updated`): a fatal's reason shows in the abort banner, and after fixing the key the user simply sends again. `credentials_updated` remains as an informational broadcast; the server-side runtime-cache invalidation it announced is unchanged.
- Tool results deliberately keep their own vocabulary (`completed` / `failed` / `aborted` / `timeout`, now the `ToolStopReason` type): a tool failure is fed back to the model as content — retry semantics do not apply. `compaction_end.status` likewise becomes its own three-value type (`completed` / `failed` / `aborted`): a failed compaction means "abandoned this time, made up at the next trigger", which is neither `retryable` nor `fatal`.
- The server's LLM error records reclassify: `llm_fatal` (unexpected), `llm_failed` (retries exhausted, unexpected), `llm_retried` (absorbed by the ladder, expected). The old `llm_auth` / `llm_timeout` / `llm_malformed` / `llm_failed_retried` codes are no longer produced. An exhausted retry run is now recorded as unexpected — previously an exhausted timeout still filed as expected.
- The model connectivity probe passes any `retryable` ending that streamed real content (previously only the `malformed` shape did): content arriving is what a connectivity test measures.
- Legacy Traces stay readable: replay only ever compares against `completed`, and the Web, CLI and trace analysis keep rendering the retired spellings — including the old fail-fast-compaction nuance for `failed` inside a compaction span.
