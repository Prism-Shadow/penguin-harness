---
title: The Agent Loop
description: The context_engine's master flow diagram and a stage-by-stage breakdown — approvals, concurrent tool execution, interrupt carry-over, automatic reconnect and compaction.
---

The SDK's single execution entry point is `session.run(newMessages, opts?)`: input is the list of new OmniMessages (the Prompt); the return value is an async generator that streams [OmniMessage](/omni-message). One `run` drives one complete Task, until the model produces a final answer with no tool calls.

This page shows the context_engine's overall flow first, then breaks down each stage; the message-level observable timeline and ordering guarantees are on [Message Flow & Ordering](/message-flow). Source: `packages/core/src/engine/context-engine.ts`.

## The loop at a glance

```text
session.run(newMessages, { approve, signal })
  │  carry-over from a previous interrupt? → prepend to this run's input
  ▼
┌── turn loop (≤ max_turns, default 100) ───────────────────────┐
│                                                               │
│  request_begin                                                │
│  LLM.streamGenerate(newMessages)                              │
│    ├─ streams partial_* fragments + complete msgs             │
│    ├─ for each complete tool_call:                            │
│    │     approve(toolCall) ──deny──► synthetic aborted output │
│    │          │allow           (approvals sequential;         │
│    │          ▼                 decision audited)             │
│    │     Environment.executeTool ──► runs concurrently,       │
│    │                                 output streams back      │
│    └─ LLMOutcome:                                             │
│         timeout / malformed ──► reconnect within the turn     │
│                    (≤2, with [turn_retried]; tools not rerun) │
│  token_usage + request_end (at LLM-stream end; not waiting   │
│                              for tools)                       │
│                                                               │
│  tool outputs reordered to original call order ──► next turn  │
│  no tool_call this turn? ──► Task ends, run returns           │
│  compaction trigger (context/turns)? ──► summarize/discard    │
│                                          + Trace rotation     │
└───────────────────────────────────────────────────────────────┘

signal fires (any point) ──► emit abort + build carry-over ──► run returns
```

Every message and event flows to two destinations at once: streamed live to the Human, and written to the [Trace](/sessions-and-traces).

## Inputs and outputs

```ts
const agent = await createAgent({ agentId: "default_agent" });
const session = await agent.createSession({ workspaceDir: process.cwd() });

for await (const output of session.run([userText("Clean up the CSV files under data/")], {
  approve: async (toolCall) => "allow",
  signal: abortController.signal,
})) {
  // output: partial_* fragments, complete model_msg, event_msg
}
```

```ts
interface RunOptions {
  signal?: AbortSignal;    // interrupt (e.g. Ctrl-C)
  approve?: ApproveFn;     // per-tool approval; denies everything when omitted (conservative default)
}
```

## Lifecycle of a turn

A Task consists of consecutive Requests (turns). Each turn:

1. emits `request_begin`;
2. the LLM streams back: `partial_*` fragments followed by complete messages;
3. every complete `tool_call` triggers exactly one `approve` callback; the decision is recorded as an `approval_decision` event;
4. approved calls run **concurrently** in the Environment (approvals themselves are one at a time); outputs stream out in completion order;
5. when the LLM stream ends, its final `token_usage` is emitted and `request_end(status)` follows at once — **without waiting for tools**: still-running tools may emit output after `request_end`;
6. once the whole batch is terminal, tool results are **reordered to the original call order** and become the next turn's input — the next Request never fires before that.

The Task ends when a turn produces no `tool_call`. A denial produces a synthetic `aborted` tool output ("Tool call denied by user.") that the model reacts to.

## Interruption and carry-over

When `signal` fires, the engine emits an `abort` event and returns immediately, while constructing carry-over content for the next `run`:

- **Case A — the model's output had completed** (the turn's `tool_call`s were committed): finished tool results are re-sent as structured `tool_call_output`s; unfinished calls get an `[interrupted: tool aborted by user]` placeholder, keeping `tool_call`/output pairing strictly intact;
- **Case B — the model's output was incomplete**: the whole turn is flattened into one `[turn_aborted]` user text carrying whatever partial output existed.

Carry-over enters the model context only — it is never written to the Trace, which records only what actually happened.

## Mid-run steering

While a Task is running, the host can queue a user message with `session.steer(text)` without interrupting the loop: the engine appends it to the next **completed** tool output as a `[user_steering]` block (part of the persisted message — Trace, stream and next-turn input all carry the same rewritten output). If the turn ends with no tool calls while steering is still queued, the queued text continues the loop as a plain user turn instead of being dropped. `steer` returns `false` when no Task is running (hosts then submit a normal task); anything still queued when a run aborts is discarded.

## Automatic reconnect

Only LLM-side `timeout` (network timeouts, rate limits, 5xx) and `malformed` (truncated streams, JSON parse failures) trigger an in-run reconnect: the engine re-sends the original input plus a `[turn_retried]` block carrying the previous partial output, so tools are never re-executed. Default limit is 2 reconnects with linear backoff (base 250ms); beyond that the turn settles as `failed`. Tool errors are never retried — they are fed back to the model as `tool_call_output` and the model decides what to do next.

## Compaction

Compaction settings are filled in from `system_config.yaml` by the composition layer:

```ts
interface CompactionSettings {
  maxContextLength: number;   // context-token threshold (last token_usage's request.total); <=0 disables
  maxSessionTurns: number;    // cumulative Session turn threshold (counted across Tasks); <=0 = unlimited
  mode: "summarize" | "discard";
  prompt: string;             // the Prompt used by summarize compaction
}
```

Three triggers (`compaction_begin.reason`):

| reason | Condition |
| --- | --- |
| `context` | last turn's `token_usage.request.total` ≥ `maxContextLength` (default 128000) |
| `turns` | Session turn count ≥ `maxSessionTurns` (default -1 = unlimited) |
| `manual` | the user runs `/compact` or calls `session.compact()` |

Two modes: `summarize` (default) appends the compaction Prompt to the old context, extracts the `[summary]`, wraps it as a `[context_summary]` user text and continues in a **fresh model context**; `discard` simply drops the old context. System markers are written as `[tag]…[/tag]`; the earlier angle-bracket form (`<summary>`, `<context_summary>`, …) is still recognized when reading old Traces and old persisted compaction prompts. Compaction rotates the [Trace file](/sessions-and-traces) (`_002`, `_003`, …) — one Trace file always equals one complete model context. `compactability()` probes feasibility before `session.compact()` (`ok | unsupported | empty | just_compacted`).

## Concurrency model

- Within a turn: approvals are sequential, execution is concurrent, and the next turn's input keeps the original order;
- within a Session: only one Task or one compaction runs at a time (the Server rejects concurrent requests with 409);
- a [Subagent](/tools) is an independent Session with its own Trace and loop; its messages are forwarded to the parent tagged with `origin`.

## Side channels

- **Session titles**: `session.generateTitle()` is a one-shot out-of-band LLM call (no tools, no system Prompt) that never enters history or Trace;
- **Usage accounting**: each turn's `token_usage` events are persisted row by row by the Server — the raw data behind the cost statistics.
