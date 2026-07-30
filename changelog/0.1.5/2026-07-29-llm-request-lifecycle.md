# Core: what a failed request does next

## Every failure but a rejected credential now retries

The engine used to reconnect on `timeout` and `malformed` only. `failed` — the bucket for "the classifier did not judge this transient" — ended the turn.

The trouble is what that classifier is: an allowlist of known error codes, HTTP statuses and message vocabulary. A gateway that words a transient fault its own way (`Upstream HTTP/2 stream failed`, say) falls straight through it and lands in `failed`. Retrying a genuinely permanent error costs the backoff ladder and then ends the same way; aborting a transient one destroys the turn. So the policy widened: **`failed` retries too, and `auth` is the only LLM status that stops the run** — a rejected credential cannot be retried into working. This changes the policy, not the taxonomy: a `failed` request is still reported as `failed` on its `request_end` and in the Cost center, not relabelled a timeout.

The retry is visible, because a retry the user cannot see is a stalled session with no explanation and no way out: `failed` renders exactly like the other two — the Web App's countdown with "retry now" and "give up", the CLI's `[retry]` line — and the attempt number keeps counting across a mixed ladder instead of restarting at #1.

Compaction retries the same set. It used to stop on `failed` while the turn loop retried it, which had the trade backwards — a compaction that gives up keeps the full context, so the next request re-triggers it against the same wall with less headroom. What stays narrower is the budget: compaction runs on its own shorter cap (3 retries) rather than the turn loop's 5.

Observability follows the policy. A `failed` the ladder recovered from is no longer filed as an operator-facing incident — it records as expected under `llm_failed_retried`, while an exhausted ladder stays unexpected under `llm_failed`. Authentication failures move to their own `llm_auth` code: they used to share the `llm_failed` deduplication bucket, so a genuine credential failure landing just behind a recovered blip was dropped outright. Trace segmentation carried a second copy of the old rule and read a retried `failed` as a turn boundary, smearing one turn's Tokens, duration and TPS across two Tasks; it now follows the engine's loop.

## A provider that ignores Stop can no longer wedge a Session

Pressing Stop mid-request could leave a Session running forever — no way to send, no way to compact, and a second Stop did nothing. Short of restarting, the Session was finished. Reported against Kimi.

The request loop already guarded half of this. Interrupting while the loop sits suspended at a `yield` — the common case, where the engine is blocked waiting for a tool approval — is caught by the abort check it runs before pulling from upstream again. Interrupting while the loop is **blocked inside the pull itself** was not covered: the provider's stream promise never settled, so nothing came back to check. The idle timer could not rescue it either, because by then the request's internal AbortController was already aborted and the timer's own abort was a no-op. Nothing was left to end the run.

The pull is now raced against a promise that settles the moment that controller aborts — whether the trigger was the user or the idle timer — so the request always closes out regardless of what upstream does. The abandoned stream is asked to close on a best-effort basis and deliberately not waited on: a stream that ignored its abort signal may well ignore that too. The terminal state is classified by which trigger fired, so Stop still ends the run as interrupted and an idle stall still ends it as a timeout that reconnects.

This is provider-agnostic on purpose. Whether a request terminates when its signal fires is the harness's guarantee to keep, not something to inherit from whichever SDK happens to be underneath.
