---
title: Message Flow & Ordering
description: How messages travel between the five actors of a turn, which orderings are guaranteed and which are not, and why stream order differs from context order.
---

[The OmniMessage Protocol](/omni-message) defines what messages are. This page explains how they move and in what order they become visible: the delivery paths within a turn, the merge mechanism behind them, and the observable timeline of a turn. It then states which orderings are guaranteed and which are not, and why order on the stream and order in the model context are two different things. Source: `packages/core/src/engine/context-engine.ts`.

## Delivery paths within a turn

Five actors take part in a turn: Human (the SDK caller), engine (`context_engine`), LLM, Environment, and Trace. Within one turn:

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
   LLM stream ends: token_usage (completed requests only) is its last message, request_end follows at once
   still-running tools keep streaming output (possibly after request_end)
   all outputs settled ──► reordered to original call order as the next turn's LLM input
```

> [!NOTE]
> Every message is written to the Trace at the same moment it enters the output stream. Stream order and Trace order therefore agree; the Trace merely skips partials and `origin`-tagged messages. See [Sessions & Traces](/sessions-and-traces).

Several of these paths run concurrently. [The merge point: MergeQueue](#the-merge-point-mergequeue) explains how their output becomes one ordered stream.

## The merge point: MergeQueue

A turn has several concurrent producers: the driver task consuming the LLM stream, plus N concurrently executing tools. All of them push into one merge queue. A single consumer, the `run` generator, yields messages one at a time in **arrival order**. The turn ends only when every producer has finished and the queue is drained.

The same pump also delivers a context opener's records. The first run's bootstrap and a compaction's `openNextContext` publish their connect pair and toolset record through it, so those records stream live too.

This one mechanism fixes three basic properties of message delivery:

- The consumer sees a single **totally ordered** stream. No client-side multiplexing is needed.
- Messages from different producers interleave by arrival time. Tool outputs arrive in **completion order**, unrelated to call order.
- Order within one producer is preserved. The LLM stream is internally ordered, and a single tool's fragments are ordered.

## The observable order within a turn

The timeline below shows a turn with two tool calls, as the consumer observes it:

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

### Denials and vetoes

When a `tool_call` is refused, line 8 carries the refusal and a synthetic `aborted` `tool_call_output` follows immediately; nothing is dispatched. The decision and the output text name who refused:

| Refused by | `approval_decision` | Synthetic output |
| --- | --- | --- |
| The approval callback | `deny` | "Tool call denied by user." |
| The command policy | `forbidden` | "Tool call denied by policy." |
| A `pre_tool_use` hook | `deny` | "Tool call denied by the <name> hook: <reason>." |

A hook that answers is recorded as a `hook` event right before the `approval_decision`.

## Guarantees and non-guarantees

The two tables below separate what a consumer may rely on from what it may not.

### Guarantees

| Guarantee | Meaning |
| --- | --- |
| Streaming discipline | every segment goes strictly `start → delta* → stop`, complete message right after; concatenated deltas ≡ the complete message |
| Approval position | `approval_decision` comes after its `tool_call` and before any output of that tool |
| Pairing | every committed `tool_call` gets exactly one complete `tool_call_output` (a denial gets the synthetic one) |
| LLM stream tail | on a completed request, `token_usage` is the LLM stream's last message and `request_end` follows immediately; a request that did not complete produces no `token_usage` |
| Commit criterion | `request_end.status === "completed"` ⇔ the turn was committed by the gateway (replay keeps or drops on this) |
| Stream order = Trace order | written as streamed; the Trace only filters partials and `origin` messages |
| Transport ordering | SSE delivers per channel with monotonic ids; reconnects replay from `Last-Event-ID` or get `resync_required` — see [Server API](/server-api) |

### Non-guarantees

Renderers must not rely on any of the following:

| Non-guarantee | Meaning |
| --- | --- |
| Tool-output order | arrival is completion order; fragments of different tools interleave — attribute by `tool_call_id` |
| `request_end` ≠ end of turn | still-running tools may emit output after `request_end` and before the next `request_begin` |
| Event/content spacing | later LLM-stream messages may land between an `approval_decision` and that tool's first output |

## Stream order vs context order

The same batch of tool outputs exists in two orders, one for each consumer:

- **Stream order** (completion order) is for the Human. Whoever finishes first becomes visible first, for real-time rendering.
- **Context order** (original call order) is for the model. Before outputs enter the next turn's input, they are reordered to the original `tool_call` order, matching provider pairing rules.

> [!WARNING]
> A renderer must never reconstruct the context from arrival order. Attach each output to its call via `tool_call_id`; the engine owns context ordering.

## Edge-case timelines

The cases below change the observable order on the stream:

| Case | Observable order on the stream |
| --- | --- |
| User interrupt | (messages produced so far) → the `abort` event — the engine's last message of the run (only `hook` events from stop hooks can follow it); carry-over goes to the model context only, never streamed, never written to Trace |
| Automatic reconnect | `request_end(retryable)` carrying `retry_in_ms` → a fresh `request_begin` (up to 5 consecutive fruitless retries, exponential backoff with a 30s ceiling); the `[turn_retried]` block is model-visible only |
| LLM failure that ends the run | `request_end(fatal)`, or a `request_end(retryable)` without `retry_in_ms` once the retries run out, is the engine's last message of the run (only `hook` events from stop hooks can follow it); no `abort` event follows, because `abort` marks only a user interruption |
| Compaction | `compaction_begin` → the compaction request runs against the old context (its raw messages are written to Trace only, except each attempt's `token_usage` and the thinking and summary being generated, which are forwarded as ordinary `partial_thinking`/`partial_text` or `thinking`/`text` inside the span) → `compaction_end(status)` |
| max_turns reached | a length notice (`[reached max turns (N); stopping]`) → the run ends; unsubmitted input is kept as carry-over |
| The Prompt itself | written to Trace, not echoed back onto the stream (the caller already has it) |
| `session_meta` | emitted on the main Session's stream only by an in-session model switch, as its last message: the new context's meta, naming the model the Session now runs on. Otherwise it lives in the Trace and the history API. A Subagent child stream's first message is the child's `session_meta` |

## Across Sessions: the origin chain

A child Session spawned by `run_subagent` has its own complete stream. When a child message is forwarded to the parent, it gets one child-Session-id hop prepended to `origin`, and it interleaves with the parent's own messages by arrival time. Renderers route by `origin` into the nested card.

Child messages are not written to the parent Trace. The parent keeps only the `subagent` pointer event, while the child's stream order is recorded in its own Trace.

## Transport ordering (SSE)

The Server pushes this exact output stream, verbatim as single-line JSON, onto the per-Session SSE channel. Event ids increase monotonically. A bounded replay buffer serves reconnects; if the replay window is gone, the Server sends `resync_required`.

On reconnect, the replayed gap (or `resync_required`) arrives first, then the authoritative `task_state` snapshot and pending approvals. A fresh connection skips replay, so `task_state` is its first event.

Details, including the bundled Web App's connect-first + dedup consumption pattern, are on the [Server API](/server-api) page.
