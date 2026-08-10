# Core: unlimited default turn cap, model-window-derived limits, slower and simpler retries, trace integrity

## Unlimited default turn cap

A new agent's `system_config.yaml` now defaults to `max_turns: -1` (unlimited) instead of `100`, and the SDK's fallback for an omitted `maxTurns` agrees, so long agent runs are no longer cut off unexpectedly by the per-Task turn cap; a positive integer still caps the Task, and `-1` remains the only accepted non-positive value. Existing agents keep their stored `max_turns` verbatim and adopt the new default via the settings page's "Restore default configuration". Goal mode's 100-round runaway backstop is unchanged, but an explicit `maxRounds: -1` now disables it (internal knob, regression-tested).

## Limits derived from the model window (vLLM and other small-window endpoints)

Running against a small-window OpenAI-compatible endpoint (e.g. a local vLLM with `--max-model-len 32768`) used to fail three ways: requests 400'd because the configured `max_tokens` went on the wire regardless of how much of the window the input already occupied, and the compaction threshold (default 128000) was unreachable inside the window. Now (#218):

- Each request's effective output cap is `min(configured max_tokens, context_window − estimated input − 1024)`, floored at 512 — a no-op for big-window cloud models. Input is estimated from the last request's real `token_usage` plus a character heuristic that errs high; images (including images inside tool outputs) count as a flat allowance rather than raw base64. Entries with no configured `context_window` (or one below 4096) are not clamped; a hard-binding clamp prints a one-line diagnostic.
- The effective compaction threshold is `min(configured max_context_length, context_window − 2048)` (headroom for the summary request's own output), replacing the old 75%-of-window rule — a 32k-window model now compacts at ~30.7k instead of never. Derived at use; stored config is never rewritten.
- The docs gain a "Local / self-hosted OpenAI-compatible endpoints (e.g. vLLM)" section (`--enable-auto-tool-choice`, `--tool-call-parser`, set the entry's context window to `max_model_len`).

## Slower, simpler LLM retries

The retry ladder's base goes 250ms → 2000ms (2s/4s/8s/16s/30s, ≈60s total patience; count and ceiling unchanged), so transient provider failures get a real recovery window and every planned wait clears the web app's countdown display floor. Classification is simplified to "every LLM error retries except auth": explicit auth signals still stop immediately, everything else — bare 403s, 400s, 429s, 5xx, quota/subscription messages, transport errors — rides the ladder and fails only after exhaustion. The quota-detection machinery (`isQuotaExhaustedError` and its message heuristics) is removed. Deliberate tradeoff: genuinely permanent errors now burn the full ladder before surfacing.

## Trace integrity under concurrent writes

Trace appends are serialized inside the writer, so concurrent producers (parallel tools, the model stream) can no longer tear a multi-megabyte record — e.g. a base64 image Data URL — into invalid JSONL (#215). Trace reads are best-effort: a malformed middle line in files damaged before the fix is skipped with a truncated stderr diagnostic and every parseable record is kept, so previously corrupted sessions resume and render again (the skip is O(n) even for heavily damaged files); server-side Trace import still validates strictly, and truncated-last-line tolerance is unchanged. The Session-index head reader shares the tolerant path, so a damaged head window no longer blocks reconciliation forever.
