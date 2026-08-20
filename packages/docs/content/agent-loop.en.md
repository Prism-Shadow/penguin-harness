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
┌── turn loop (≤ max_turns; default -1 = no cap) ───────────────┐
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
│    failed/timeout/malformed ──► reconnect within the turn     │
│                    (≤5, with [turn_retried]; tools not rerun) │
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
  thinkingLevel?: ThinkingLevelName;   // this run's thinking level (per-turn, carried through reconnect retries; compaction requests keep the default)
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

While a Task is running, the host can queue a user message with `session.steer(input)` — an OmniMessage list, the same shape `run` takes a Prompt in — without interrupting the loop: at the next input assembly the engine delivers it as a **standalone user text message** wrapped in `[user_steering]…[/user_steering]`, sent alongside that turn's tool outputs (or alone as the continuation input when the turn produced no tool calls — the Task keeps going instead of ending). The input's user text becomes the block's body; its images follow it as ordinary user image messages, so an image with no caption is a complete steering message; on a model without vision they fold into `[attached image: <path>]` lines **inside** the block instead, exactly as a Prompt's images do (the block must stay the whole text, or the message would lose its steering identity and read as a new Task). Steering is real user input: written to Trace like any Prompt, yielded to the output stream, and replayed as ordinary turn input on resume; tool outputs are never rewritten. The queue is drained at **every** input assembly — including right after a mid-run compaction, so steering that arrives during the compaction request is delivered, never swallowed. `steer` returns `false` when no Task is running (hosts then submit a normal task); the queue is discarded only when the run exits (abort included).

## Input images

An input image either rides the request as an image message or becomes an `[attached image: <path>]` line pointing at a file in the session scratchpad — the model then views it with `read_image` / `describe_image`, and the Web restores the thumbnail from the path. The conversion is one function bound once per Session (it is the only layer that knows both the scratchpad and the model's capability), and **each input path decides for itself whether to apply it**:

| Input | Folds when | Applied at |
| --- | --- | --- |
| Prompt (`run`) | the model has no vision | run entry, before Trace and title material |
| Steering (`steer`) | the model has no vision | delivery, at the turn boundary — queuing must stay synchronous, and a queue discarded on abort would otherwise leave orphan files |
| Goal objective | **always** | before the objective is extracted, so the path lines survive every round's re-injection |

Goal mode is the exception because its objective is re-injected as text every round: see [Goal mode](/goal-mode).

## Automatic reconnect

Every LLM-side failure except `auth` triggers an in-run reconnect — `timeout` (transport-shaped errors: network timeouts, transport disconnects, rate limits, 5xx), `malformed` (truncated streams, JSON parse failures), and **`failed` as well** — every provider rejection that isn't an explicit credential failure, bare 403s and quota/subscription errors included. The statuses are taxonomy, not policy: the classifier only picks the label, and a gateway phrasing a transient fault its own way (`Upstream HTTP/2 stream failed`, say) or a quota that refills mid-ladder retries exactly like a network drop. Retrying a genuinely permanent error costs the ladder and ends the same way; aborting a transient one destroys the turn. Note this changes the *policy*, not the *taxonomy*: a `failed` request is still recorded as `failed` on its `request_end` and in the Cost center, rather than being relabelled a timeout. On a reconnect the engine re-sends the original input plus a `[turn_retried]` block carrying the previous partial output, so tools are never re-executed. Default limit is 5 reconnects with exponential backoff under a ceiling (base 2s, cap 30s: 2s, 4s, 8s, 16s, 30s ≈ 60s of total patience — one shared schedule for every retryable class, sized so transient provider failures such as restarts and rate limits get a real recovery window instead of five retries burning out in about a second, and so every planned wait clears the Web App's 2s countdown floor and stays visible); beyond that the turn settles as `failed`. Each failure's `request_end` announces the planned wait as `retry_in_ms` (same formula as the sleep) and stamps `attempt`, the authoritative 1-based ordinal of the request within its retry run (the CLI and Web App display it verbatim); the Web App renders the wait as a live countdown with "retry now" (skips the remaining wait via `Session.skipReconnectWait` — the attempt counter is unchanged) and "give up" (the ordinary abort; the engine's abort-during-backoff path ends the turn) controls; the CLI prints its own `[retry]` line. All three retryable statuses render identically — a retry the user cannot see is a stalled session with no explanation and no way out. A compaction request is an ordinary LLM request and by default retries on the same cap and ladder (an unusable summary draws on the same budget — see "Context compaction"); a compaction that gives up keeps the original context and tries again at the next trigger. Authentication errors are classified before any retry heuristic and never retry: the request ends with its own terminal status `auth` (only the model reference is fixed at Session creation — credentials are read from the current Project config when the Session loads), and the Web App disables that Session's composer until the model's credential is updated (which auto-unlocks it) or the notice is dismissed for a retry. Tool errors are never retried — they are fed back to the model as `tool_call_output` and the model decides what to do next.

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
| `context` | last turn's `token_usage.request.total` ≥ `maxContextLength` (default 128000; the effective threshold is capped at the model's `context_window` − 2048, so a small-window model — a 32k local vLLM, say — compacts at ~30.7k instead of overflowing the window first; an entry without `context_window` derives from the assumed 128000 default) |
| `turns` | Session turn count ≥ `maxSessionTurns` (default -1 = unlimited) |
| `manual` | the user runs `/compact` or calls `session.compact()` |

Two modes: `summarize` (default) appends the compaction Prompt to the old context, extracts the `[summary]`, wraps it as a `[context_summary]` user text and continues in a **fresh model context**; `discard` simply drops the old context. System markers are written as `[tag]…[/tag]`; the earlier angle-bracket form (`<summary>`, `<context_summary>`, …) is still recognized when reading old Traces and old persisted compaction prompts. Summary extraction applies a tolerance ladder: the first non-empty `[summary]` tag pair wins; when every pair is empty, the text left after stripping the tags is used instead (rescuing models that write the body after the closing tag); with no tags at all, the whole output is used verbatim. Compaction rotates the [Trace file](/sessions-and-traces) (`_002`, `_003`, …) — one Trace file always equals one complete model context. `compactability()` probes feasibility before `session.compact()` (`ok | unsupported | empty | just_compacted`).

The compaction request keeps the session's toolset **unchanged** — the request prefix (tool list included) stays byte-identical to ordinary turns, so the provider's prompt cache remains valid at the moment the context is largest. Compaction still succeeds only with a valid summary: a response that calls a tool or whose extracted summary is empty counts as one more failed attempt — any tool calls are answered with synthesized failed outputs (keeping `tool_use`/`tool_result` pairing intact), and the resent request carries a corrective note ahead of the compaction Prompt (committed history can only be appended to; rewriting it would invalidate the prompt cache). Every failure — unusable summaries and the `failed`/`timeout`/`malformed` transport statuses alike — draws on the one reconnect budget and backoff ladder described under "Automatic reconnect" above; only `auth` stops the compaction at once. Once the budget is exhausted the compaction ends `failed`, keeping the original context and Trace file until the next trigger; `compaction_end` reuses the unified retry detail block — `attempt` (the final attempt's ordinal, failed attempts included) and, on failure, the last `error_message` detail (shown on the chat banner and the CLI line) — and a failed compaction also lands in the cost center as a `compaction_failed` error record. The first **committed** attempt — adopted or rejected — also absorbs whatever turn input was folded into the compaction request (mid-Task tool results, or the carry-over a manual `/compact` folds in) into the old context's history: retries resend only the repairs and the Prompt, and nothing resends the absorbed input afterwards.

An abandoned compaction is **made up later**, never patched over. Mid-Task the run ends the way any interruption does: the turn's still-pending state is held as carry-over under the same committed/not-committed rule, an `abort` event closes the run, and the next message resends that carry-over merged with the user's input — where the still-standing threshold triggers the compaction again. At a Task boundary the run simply ends with the original context kept. Either way nothing synthetic is invented to keep the loop running on a context that was supposed to shrink.

Compaction triggered **mid-Task** never preempts the tools: `runTurn` returns only once every tool call of the turn has completed, so the results are ready and paired before the checkpoint is even reached. They then ride the compaction request itself, ahead of the compaction Prompt, in their original call order — whatever a tool produced (a normal result, a `[tool error]`, a denial) is what the summary is written from. A tool that waits on approval or runs for minutes simply delays the compaction; no clock is running on it, because the compaction request has not been issued yet. Nothing synthetic is inserted to close the exchange.

While the summary is being generated it rides the output stream as ordinary `partial_text` (or the complete `text`, for LLM implementations that stream nothing), positioned between the paired compaction events — no separate event type, and the compaction request's other raw messages stay Trace-only as before. The Web App renders the compaction row **collapsed by default, exactly like a thinking block**: the chevron is there from the start of a summarize compaction and the summary streams inside the collapsed body, which the reader expands to watch it being written or to read it afterwards. A history rebuild reads the same text back from the compaction span's recorded output, so a reload shows exactly what the live viewer saw. Consumers that render a transcript already treat model messages inside the span as compaction-internal, so nothing leaks into the conversation.

A compaction the user quit out of — the process died mid-request, leaving a `compaction_begin` with no matching end — is simply a **failed compaction**. When the session next loads, resume closes the span with a `failed` `compaction_end` before appending anything else and **discards the half-written summary**: nothing is reconstructed from it, the original context stands, and the standing threshold makes the compaction up at the next trigger. Closing the span is what keeps the conversation that follows visible — every reader treats messages between the paired events as compaction-internal — and the Web App drops the partial draft from the row rather than showing a truncated summary as if it had been adopted.

## Concurrency model

- Within a turn: approvals are sequential, execution is concurrent, and the next turn's input keeps the original order;
- within a Session: only one Task or one compaction runs at a time (the Server rejects concurrent requests with 409);
- a [Subagent](/tools) is an independent Session with its own Trace and loop; its messages are forwarded to the parent tagged with `origin`.

## Side channels

- **Session titles**: `session.generateTitle()` is a one-shot out-of-band LLM call (no tools, no system Prompt) that never enters history or Trace;
- **Usage accounting**: each turn's `token_usage` events are persisted row by row by the Server — the raw data behind the cost statistics.
