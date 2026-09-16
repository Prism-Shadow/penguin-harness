# The core suite pins prompt-cache-aware request assembly

- **Date:** 2026-09-14
- **Type:** process
- **Scope:** `core`
- **PR:** [#722](https://github.com/Prism-Shadow/penguin-harness/pull/722)

[中文版](2026-09-14-prompt-cache-awareness.zh.md)

A provider serves a cached prefix only when the next request repeats the previous one byte for
byte from the front — tools, then the system prompt, then the messages — so every turn the engine
assembles has to leave the request an extension of the last one.
`packages/core/test/prompt-cache-invariants.test.ts` now pins that: a real `ContextEngine` drives
a real `GenerativeModel` whose provider stream is scripted, and each consecutive pair of requests
is diagnosed on the wire shape the client would have sent, by a client-side diagnostic modelled
on the cache-miss reasons a provider reports (`model_changed` / `system_changed` /
`tools_changed` / `parameters_changed` / `messages_changed`, earliest divergence first, with an
estimate of the input that falls after it).

## Details

- Pinned as behaviour: every request of a session extends the previous one; a steering message
  delivered mid-task rides the same user turn as the tool result; a thinking-level move costs
  exactly one `parameters_changed` and then holds — the compaction request and the context
  compaction opens both carry the moved level; the compaction request extends the turn it
  follows; and a resumed session's first request opens with the live client's committed history,
  thinking signatures and tool pairing included.
- One reading was worth stating as its own invariant: a reconnect after a partially streamed attempt re-sends the turn with a `[turn_retried]` note carrying what the attempt already produced, so the retried turn's input grows rather than repeating. Everything before that input stays byte-identical (tools, system prompt and history still hit); the suite pins that the divergence never moves earlier and that the original input still leads the retried one.
- `packages/core/test/helpers/prompt-cache/` holds the shared machinery, a file per part:
  `recording.ts` (the scripted provider stream and the per-request wire recording),
  `diagnostics.ts` (the cache-miss diagnostic), `simulator.ts` (the provider half below) and
  `fixtures.ts` (the agent, the fake collaborators and the hit assertion the two Session suites
  share), re-exported from `index.ts`. The recording and the diagnostic measure the harness's half
  only: cache lifetime, breakpoint lookback and minimum cacheable size belong to the provider —
  modelled offline by the simulator, though only a live endpoint proves a real deployment behaves
  this way.
- `packages/core/test/helpers/prompt-cache/simulator.ts` adds that provider half as a rule engine
  over the same recordings: an Anthropic-shaped prompt cache that reads each request as a block
  list (the model id, one block per tool, a virtual block for the fast-mode parameters, the
  system prompt, a virtual block for the remaining prompt-affecting parameters, then every
  message content block), groups it into positions — a run of `tool_use` or `tool_result` blocks
  counting as one — writes **only at a breakpoint**, serves a read by looking back at most twenty
  positions from each breakpoint's own position (the breakpoint itself counting as the first),
  refuses a prefix under 1024 tokens, and expires an entry five minutes after its last use on an
  injected clock. That block order is what reproduces the documented invalidation hierarchy, the
  cache's scoping to one model included: a model switch loses everything and no breakpoint can be
  placed in front of it, a fast-mode toggle keeps the tools and loses the system prompt, and a
  thinking-level move keeps both — on the models that render the thinking configuration after
  them, which the documentation marks as model-specific. By default it models what AgentHub's
  Claude client sends: one
  automatic breakpoint at the last block, so the only entries in the cache end at whole requests
  and content sitting behind a breakpoint is never separately addressable. A
  `breakpoints: "tools-system-automatic"` option models the alternative the API allows —
  explicit breakpoints on the last tool block and on the system block alongside the automatic
  one. It answers in the numbers a provider reports: `cache_read_input_tokens`,
  `cache_creation_input_tokens`, `input_tokens` and the resulting hit ratio.
  `packages/core/test/prompt-cache-simulator.test.ts` pins those rules on hand-built requests.
- `packages/core/test/prompt-cache-lifecycle.test.ts` runs a real `Session` through the Session
  lifecycle against one simulated provider — child sessions and reopened contexts included — and
  asserts on those numbers that every request reads back the whole prefix of its context's
  previous request: an ordinary conversation, an interruption, a `run_in_background` command's
  completion notice, a call the user moves to the background, three parallel tool calls, a
  subagent, a scheduled-task trigger, a resume through a Trace, a thinking-level move and a
  compaction. Every case that cannot hit by design is named with its reason and its loss bounded:
  an interruption falls back to the breakpoint the request before it closed; and a thinking-level
  move, a compaction reopen and a subagent child's first request each read nothing at all, even
  where the tools and the system prompt go out byte-identical, because with one breakpoint at the
  end of the request no entry ever ended at the system block.
- What the extra breakpoints would recover is measured rather than argued, and measured on
  hand-built requests so it costs no scenario run and cannot move when AgentHub changes: under
  `breakpoints: "tools-system-automatic"` a system-prompt change still reads the tools back, a
  fast-mode toggle still reads the tools back, a thinking-level move still reads the tools and
  the system prompt back, and a conversation whose messages have run far past the lookback window
  still reads the fixed prefix back from the breakpoint that sits next to it — where the single
  automatic breakpoint the harness sends today reads nothing in every one of those cases. The
  parameters block behind the system breakpoint stays unreadable either way, so a thinking-level
  move still costs the messages.
