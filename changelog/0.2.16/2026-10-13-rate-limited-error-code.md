# A provider 429 is classified apart from a transport drop

- **Date:** 2026-10-13
- **Type:** feature
- **Scope:** `core`
- **PR:** [#1114](https://github.com/Prism-Shadow/penguin-harness/pull/1114)

[中文版](2026-10-13-rate-limited-error-code.zh.md)

A 429 and a dropped connection were the same `error_code` — `network` — so nothing downstream could tell "the wire blipped, try again in a moment" from "this model has no quota left, and the same request will 429 again after every backoff rung".

## What changes

- **`ErrorCode` gains `rate_limited`**: the provider answered 429, which is its rate limit or a quota that is exhausted for now. `isRateLimitError` (exported beside `isFatalProviderRejection`) reads it off any level of the error's `cause` chain, the way the fatal check does.
- **The outcome stays `retryable`.** A short burst is exactly what the reconnect ladder is for, and the classification does not change when the run gives up or what it retries — it only names the cause.
- Everything else about the vocabulary is unchanged: a transport drop is still `network`, a 5xx is still `network`, and the `request_end` event carries the code as `error_code` exactly as before.

## Why a host wants it

The two failures call for different actions. One is waited out; the other is a Session that has somewhere else to run — given the harness now owns an in-session model switch (`Session.switchModel`, the `model_switch` record, and the server's `updateModel` write), telling them apart in the outcome is what makes that decision possible at all, and it is the first step of moving a rate-limited Session onto another model rather than spending the ~60 s ladder on a quota that is gone.

It also reaches observability unchanged: the Cost center's errors panel groups on `error_code`, so rate limits stop hiding inside the network bucket.
