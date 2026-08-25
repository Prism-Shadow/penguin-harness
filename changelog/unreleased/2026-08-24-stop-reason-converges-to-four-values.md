# Stop reasons converge to four values

- **Date:** 2026-08-24
- **Type:** refactor
- **Scope:** `core`, `server`, `web`, `cli`
- **Breaking:** yes — `StopReason` drops `failed` / `timeout` / `malformed` / `auth` in favor of `retryable` / `fatal` and becomes the only stop-reason vocabulary (`ToolStopReason` / `CompactionStatus` / `McpConnectStatus` are removed); `LLMOutcome.permanent` is removed; the Web composer's auth-dead gate is retired

[中文版](2026-08-24-stop-reason-converges-to-four-values.zh.md)

There is now exactly one stop-reason vocabulary: `completed` / `aborted` / `retryable` / `fatal`, used by every message and event that carries a stop reason — LLM fragments, tool outputs, compaction ends, MCP connect ends. A stop reason answers exactly one question — should this be retried — and the concrete failure rides on `error_message` (`LLMOutcome.errorMessage` → `request_end.error_message`) instead of on the reason value.

**`retryable`** covers everything worth another attempt: transport drops, idle timeouts, 408/429/5xx, malformed or truncated responses, and every unclassifiable error — the fatal detector is a deterministic allowlist, so a gateway phrasing a transient fault its own way keeps its retries. The engine reconnects on the existing backoff ladder, unchanged.

**`fatal`** covers what no retry can fix: a provider 4xx rejection (408/429 excluded), a credentials failure, fast mode on a model without a fast tier, and input that fails to assemble into a request. The engine stops the run and surfaces the message at once. Previously a deterministic 400 was classified `failed` and burned the whole five-step ladder before the user saw the actionable error — the direct motivation, uncovered while diagnosing the Vertex mixed-content 400.

## Details

- `LLMOutcome.permanent` is gone: `fatal` is the classification, not a flag on a classification. The engine's fatal branch replaces the former `auth` and permanent-failed branches.
- The dedicated `auth` status is gone, and with it the Web composer's auth-dead input gate (the time-gated lock cleared by `credentials_updated`): a fatal's reason shows in the abort banner, and after fixing the key the user simply sends again. `credentials_updated` remains as an informational broadcast; the server-side runtime-cache invalidation it announced is unchanged.
- Tool outputs rarely say `retryable`: a tool error or timeout is definitive for that call — nothing in the harness retries a tool — so failures converge to `fatal` and are fed back to the model as content for it to adjust. The separate `ToolStopReason` type is gone.
- `compaction_end.status` distinguishes `retryable` — abandoned this time on exhausted retries, and the standing trigger makes it up at the next opportunity — from `fatal` — the attempt died on a failure no retry can fix, so the model configuration needs fixing first. The Web and CLI compaction banners word the two differently. The separate `CompactionStatus` type is gone.
- `mcp_connect_end` (overall and per-server) joins the same vocabulary: a failed connect is `fatal` — nothing retries it within the run. The separate `McpConnectStatus` type is gone.
- The server's error records reclassify: `llm_fatal` (unexpected), `llm_failed` (retries exhausted, unexpected), `llm_retried` (absorbed by the ladder, expected); tool failures file as `tool_fatal:<name>`. The old `llm_auth` / `llm_timeout` / `llm_malformed` / `llm_failed_retried` / `tool_failed:` / `tool_timeout:` codes are no longer produced. An exhausted retry run is now recorded as unexpected — previously an exhausted timeout still filed as expected.
- The model connectivity probe passes any `retryable` ending that streamed real content (previously only the `malformed` shape did): content arriving is what a connectivity test measures.
- Legacy Traces stay readable: replay only ever compares against `completed`, and the Web, CLI and trace analysis keep rendering the retired spellings (`failed` / `timeout` / `malformed` / `auth` on LLM fragments, `failed` / `timeout` on tool outputs, `failed` on compaction and MCP ends).
