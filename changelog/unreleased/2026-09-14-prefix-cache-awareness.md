# The core suite pins prompt-cache-aware request assembly

- **Date:** 2026-09-14
- **Type:** test
- **Scope:** `core`
- **PR:** [#722](https://github.com/Prism-Shadow/penguin-harness/pull/722)

[中文版](2026-09-14-prefix-cache-awareness.zh.md)

A provider serves a cached prefix only when the next request repeats the previous one byte for
byte from the front — tools, then the system prompt, then the messages — so every turn the engine
assembles has to leave the request an extension of the last one. `packages/core/test/prefix-cache.test.ts`
now pins that: a real `ContextEngine` drives a real `GenerativeModel` whose provider stream is
scripted, and each consecutive pair of requests is diagnosed on the wire shape the client would
have sent, by a client-side diagnostic modelled on the cache-miss reasons a provider reports
(`model_changed` / `system_changed` / `tools_changed` / `parameters_changed` / `messages_changed`,
earliest divergence first, with an estimate of the input that falls after it).

## Details

- Pinned as behaviour: every request of a session extends the previous one; a steering message
  delivered mid-task rides the same user turn as the tool result; a thinking-level move costs
  exactly one `parameters_changed` and then holds — the compaction request and the context
  compaction opens both carry the moved level; the compaction request extends the turn it
  follows; and a resumed session's first request opens with the live client's committed history,
  thinking signatures and tool pairing included.
- One reading was worth stating as its own invariant: a reconnect after a partially streamed attempt re-sends the turn with a `[turn_retried]` note carrying what the attempt already produced, so the retried turn's input grows rather than repeating. Everything before that input stays byte-identical (tools, system prompt and history still hit); the suite pins that the divergence never moves earlier and that the original input still leads the retried one.
- `packages/core/test/helpers/prefix-cache.ts` holds the recording model, the diagnostic and the
  wire-history reader. It measures the harness's half only: cache lifetime, breakpoint lookback
  and minimum cacheable size belong to the provider and need a live endpoint.
