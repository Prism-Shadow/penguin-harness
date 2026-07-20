# Model test no longer fails on thinking-only responses

Testing a reasoning-heavy model (e.g. qwen3.8-max-preview) failed with "OpenaiClient
returned no content other than thinking (finish_reason=\"length\")": the connectivity
probe's tiny output cap was burned entirely on thinking. The probe now counts a streamed
thinking-only ending as reachable — the endpoint, credential, and model id all
demonstrably work.

## Details

- The probe deliberately sends one "ping" with `maxTokens: 16` and thinking disabled
  (single-digit token cost by design). Reasoning models behind OpenAI-compatible endpoints
  can ignore the disabled thinking level, hit `finish_reason=length` with no text, and
  AgentHub 0.4 raises `EmptyResponseError` — collapsed to a `malformed` outcome, which the
  probe previously reported as a test failure.
- `testModel` now tracks whether genuine model content (thinking or text, partial or
  complete) was streamed, and a `malformed` ending after streamed content passes the test;
  timeouts, auth/parameter failures, and malformed endings with nothing received still
  fail. The logic lives in two pure functions (`isProbeContent` / `probeVerdict`) with unit
  tests, including the exact qwen3.8-max-preview case.
