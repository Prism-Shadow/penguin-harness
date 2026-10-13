# A 4xx a gateway raised for its own upstream failure no longer ends the run

- **Date:** 2026-10-13
- **Type:** fix
- **Scope:** `core`
- **PR:** [#1103](https://github.com/Prism-Shadow/penguin-harness/pull/1103)

[中文版](2026-10-13-server-side-4xx-is-not-fatal.zh.md)

`isFatalProviderRejection` decided on the status code alone: any 4xx except 408 and 429 was a definitive rejection of the request, so the run stopped there instead of riding the retry ladder. A gateway in front of a provider does not keep that contract — it answers breakage on its own side with whatever 4xx it likes.

## What decides now

A 4xx is fatal only when the provider's own payload neither declares a server-side failure nor is empty. Two signals are read off each level of the `cause` chain before the status is judged:

- **A provider code** naming the failure as the provider's own — `server_error`, `api_error`, `upstream_error`, `internal_error`, `service_unavailable`, `overloaded_error`, `no_available_workers` — read the way the existing `providerSignals` reads codes off an error and its parsed body.
- **A message shape**, for the cases where no code survives: `[server_error]`-style brackets, `Upstream response was not valid JSON`, `Model is unavailable`, and `(upstream|provider|service) (is) temporarily unavailable`.
- **An empty provider body** — the SDK's `NNN status code (no body)` — which carries nothing to justify stopping the run.

Anything else keeps the previous behaviour, so a genuine rejection is still fatal on the first attempt: `413 … Request body exceeds the 4.5 MiB limit` and `400 … No function call found for function call output` both stay fatal, and a 401 still ends through `isAuthenticationError` ahead of this check.

## Details

- `SERVER_SIDE_CODES`, `SERVER_SIDE_TEXT`, `declaresServerSideFailure` and `hasEmptyProviderBody` are new; `isFatalProviderRejection` consults them first and falls through to the status check it had.
- Ten cases pin the boundary in `packages/core/test/llm.test.ts`: seven real gateway payloads that must stay retryable, and real rejections plus chained/structured signals that must stay fatal.
