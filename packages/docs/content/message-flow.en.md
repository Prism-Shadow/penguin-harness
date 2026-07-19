---
title: Message Flow & Ordering
description: How messages travel between Human, engine, LLM, Environment and Trace — every ordering guarantee and non-guarantee, and why stream order differs from context order.
---

[The OmniMessage Protocol](/omni-message) defines what messages *are*; this page explains how they *move* and in what order they become visible: the delivery paths, the merge mechanism, the observable timeline within a turn, which orderings are guaranteed, which are not, and why "order on the stream" and "order in the model context" are two different things. Source of truth: `packages/core/src/engine/context-engine.ts`.

## Delivery paths within a turn

Five actors: Human (the SDK caller), engine (context_engine), LLM, Environment, Trace. Within one turn:

```text
Human ──run(newMessages)──► engine
                            engine ──write Prompt──────────────────► Trace
                            engine ──request_begin──► Human and Trace
                            engine ──streamGenerate(new messages)──► LLM
        ┌────────────  LLM streams partial_* and complete messages ────────┐
        │  engine forwards each: simultaneously ──► Human (yield)          │
        │                                      and ──► Trace (write)       │
        └──────────────────────────────────────────────────────────────────┘
   complete tool_call ──► engine: await approve(tc) (one at a time)
                            engine ──approval_decision──► Human and Trace
                 allow ──► Environment.executeTool (concurrent, never blocks the LLM stream)
        Environment ──partial_tool_call_output──► Human, and (complete) ──► Trace
   LLM stream ends: token_usage is its last message, request_end follows at once
   still-running tools keep streaming output (possibly after request_end)
   all outputs settled ──► reordered to original call order as the next turn's LLM input
```

Key point: **every message is written to the Trace at the same moment it enters the output stream**, so stream order and Trace order agree (the Trace merely skips partials and `origin`-tagged messages — see [Sessions & Traces](/sessions-and-traces)).

## The merge point: MergeQueue

A turn has several concurrent producers: the driver task consuming the LLM stream, plus N concurrently executing tools. All of them push into one merge queue, and a **single consumer** (the `run` generator) yields messages one at a time in **arrival order**; the turn ends only when every producer has finished and the queue is drained.

This one mechanism fixes three basic properties of message delivery:

1. the consumer sees a single **totally ordered** stream — no client-side multiplexing needed;
2. messages from different producers interleave by arrival time — tool outputs arrive in **completion order**, unrelated to call order;
3. order *within* one producer is preserved (the LLM stream is internally ordered; a single tool's fragments are ordered).

## The observable order within a turn

A turn with two tool calls, as the consumer observes it (annotated):

```text
 1   event     request_begin
 2   partial   partial_thinking(start → delta… → stop)
 3   complete  thinking                       ← the complete message right after stop
 4   partial   partial_text(start → delta… → stop)
 5   complete  text
 6   partial   partial_tool_call A(start → delta… → stop)
 7   complete  tool_call A
 8   event     approval_decision(allow, A)    ← approvals are sequential; A starts executing
 9   partial   partial_tool_call B(…)         ← the LLM stream continues, not waiting for A
10   complete  tool_call B
11   event     approval_decision(allow, B)
12   partial   partial_tool_call_output B(…)  ← B produces output first: completion order
13   complete  tool_call_output B
14   event     token_usage                    ← the LLM stream's last message
15   event     request_end(completed)         ← emitted when the LLM stream ends, not waiting for tools
16   partial   partial_tool_call_output A(…)  ← late output lands after request_end
17   complete  tool_call_output A
     (A and B settled → re-fed in A, B original order → next request_begin)
```

If a `tool_call` is denied, line 8 carries `deny` and a synthetic `aborted` `tool_call_output` ("Tool call denied by user.") follows immediately — nothing is dispatched.

## Guarantees and non-guarantees

**Guaranteed:**

| Guarantee | Meaning |
| --- | --- |
| Streaming discipline | every segment goes strictly `start → delta* → stop`, complete message right after; concatenated deltas ≡ the complete message |
| Approval position | `approval_decision` comes after its `tool_call` and before any output of that tool |
| Pairing | every committed `tool_call` gets exactly one complete `tool_call_output` (a denial gets the synthetic one) |
| LLM stream tail | `token_usage` is the LLM stream's last message, `request_end` follows immediately |
| Commit criterion | `request_end.status === "completed"` ⇔ the turn was committed by the gateway (replay keeps or drops on this) |
| Stream order = Trace order | written as streamed; the Trace only filters partials and `origin` messages |
| Transport ordering | SSE delivers per channel with monotonic ids; reconnects replay from `Last-Event-ID` or get `resync_required` — see [Server API](/server-api) |

**Not guaranteed (renderers must not rely on these):**

| Non-guarantee | Meaning |
| --- | --- |
| Tool-output order | arrival is completion order; fragments of different tools interleave — attribute by `tool_call_id` |
| `request_end` ≠ end of turn | still-running tools may emit output after `request_end` and before the next `request_begin` |
| Event/content spacing | later LLM-stream messages may land between an `approval_decision` and that tool's first output |

## Stream order vs context order

The same batch of tool outputs exists in two orders, serving two different consumers:

- **stream order (completion order)** — for the Human: whoever finishes first is visible first, for real-time rendering;
- **context order (original call order)** — for the model: before entering the next turn's input, outputs are reordered to the original `tool_call` order, matching provider pairing rules.

Therefore **a renderer must never reconstruct the context from arrival order** — hang each output onto its call via `tool_call_id`; the engine owns context ordering.

## Edge-case timelines

| Case | Observable order on the stream |
| --- | --- |
| User interrupt | (messages produced so far) → the `abort` event — the last message before `run` returns; carry-over goes to the model context only, never streamed, never written to Trace |
| Automatic reconnect | `request_end(timeout \| malformed)` → a fresh `request_begin`; the `<turn_retried>` block is model-visible only |
| Compaction | `compaction_begin` → the compaction request runs against the old context (its streamed output is **not** forwarded, only written to Trace) → that request's `token_usage` → `compaction_end(status)` |
| max_turns reached | a length notice → the run ends; unsubmitted input is kept as carry-over |
| The Prompt itself | written to Trace, not echoed back onto the stream (the caller already has it) |
| session_meta | never emitted on the main Session's stream (it lives in the Trace and the history API); a Subagent child stream's **first** message is the child's `session_meta` |

## Across Sessions: the origin chain

A child Session spawned by `run_subagent` has its own complete stream. When forwarded to the parent, each child message gets one child-Session-id hop prepended to `origin`, and it interleaves with the parent's own messages **by arrival time**; renderers route by `origin` into the nested card. Child messages are not written to the parent Trace — the parent keeps only the `subagent` pointer event, while the child's stream order is recorded in its own Trace.

## Transport ordering (SSE)

The Server pushes this exact output stream verbatim (single-line JSON) onto the per-Session SSE channel: monotonically increasing event ids, a bounded replay buffer for reconnects, `resync_required` when the replay window is gone. Event order: on reconnect the replayed gap (or `resync_required`) comes first, then the authoritative `task_state` snapshot and pending approvals; a fresh connection skips replay, so `task_state` is its first event. Details — including the bundled Web App's connect-first + dedup consumption pattern — are on the [Server API](/server-api) page.
