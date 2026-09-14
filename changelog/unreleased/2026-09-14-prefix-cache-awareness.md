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
  and minimum cacheable size belong to the provider — modelled offline by the simulator below,
  though only a live endpoint proves a real deployment behaves this way.
- `packages/core/test/helpers/prompt-cache-sim.ts` adds that provider half as a rule engine over
  the same recordings: an Anthropic-shaped prompt cache that reads each request as a block list
  (one block per tool, the system prompt, a virtual block holding the prompt-affecting
  parameters, then every message content block), groups it into positions — a run of `tool_use`
  or `tool_result` blocks counting as one — writes **only at a breakpoint**, serves a read by
  checking at most twenty positions per breakpoint (the breakpoint itself counting as the
  first), refuses a prefix under 1024 tokens, and expires an entry five minutes after its last
  use on an injected clock. By default it models what AgentHub's Claude client sends: one
  automatic breakpoint at the last block, so the only entries in the cache end at whole requests
  and content sitting behind a breakpoint is never separately addressable. A
  `breakpoints: "tools-system-automatic"` option models the alternative the API allows —
  explicit breakpoints on the last tool block and on the system block alongside the automatic
  one. It answers in the numbers a provider reports: `cache_read_input_tokens`,
  `cache_creation_input_tokens`, `input_tokens` and the resulting hit ratio.
  `packages/core/test/prompt-cache-sim.test.ts` pins those rules on hand-built requests.
- `packages/core/test/prompt-cache-hits.test.ts` runs a real `Session` through the session
  lifecycle against one simulated provider — child sessions and reopened contexts included — and
  asserts on those numbers that every request reads back the whole prefix of its context's
  previous request: an ordinary conversation, an interruption, a `run_in_background` command's
  completion notice, a call the user moves to the background, three parallel tool calls, a
  subagent, a scheduled-task trigger, a resume through a Trace, a thinking-level move and a
  compaction. Every case that cannot hit by design is named with its reason and its loss bounded:
  an interruption falls back to the breakpoint the request before it closed; a thinking-level
  move, a compaction reopen and a subagent child's first request each read nothing at all, even
  where the tools and the system prompt go out byte-identical, because with one breakpoint at the
  end of the request no entry ever ended at the system block; and a resume past the five-minute
  lifetime reads nothing although the diagnostic reports no divergence at all.
- One further test reruns the thinking-move and compaction flows under
  `breakpoints: "tools-system-automatic"`, where both reads come back as the tools plus the
  system prompt (96.3% and 96.8% hit ratios against 0% today). The recommendation to set those
  two breakpoints in AgentHub is therefore measured rather than argued — and the measurement also
  shows the parameters block behind the system breakpoint stays unreadable, so a thinking-level
  move still costs the messages.
