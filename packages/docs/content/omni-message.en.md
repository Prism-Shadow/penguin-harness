---
title: The OmniMessage Protocol
description: One envelope, three message types, a five-value stop_reason — the unified protocol behind the SDK, the Trace and SSE, field by field.
---

OmniMessage is PenguinHarness's unified message protocol: the SDK yields it, the Trace stores it line by line, and the Server pushes it verbatim over SSE. What streams, what is stored and what the model sees are one structure — there is no second format between front end, back end and storage.

This page goes top-down: the envelope and the three message types first, then every payload field by field, then the protocol-wide semantics (streaming discipline, stop_reason, origin, fidelity fields). Type source: `packages/core/src/omnimessage/types.ts`.

## The envelope

Every message shares one envelope; only the `payload` varies:

```ts
interface OmniMessage<P extends OmniPayload = OmniPayload> {
  timestamp: string;        // ISO 8601 UTC
  type: "session_meta" | "model_msg" | "event_msg";
  payload: P;
  origin?: string[];        // child-Session chain (outer→inner); absent = main Session
}
```

What each message type carries:

| type | Meaning | Volume |
| --- | --- | --- |
| `session_meta` | The full runtime configuration of one model context | exactly one per context |
| `model_msg` | Content inside the model context (text, thinking, tool calls and results) | the bulk |
| `event_msg` | Runtime events outside the context (approvals, usage, compaction, aborts) | alongside |

## session_meta

```ts
interface SessionMetaPayload {
  session_id: string;
  provider: string;                       // one half of the model-identity pair
  model_id: string;                       // the upstream request id sent to AgentHub
  model_context_window: number | string;
  system_prompt: string;                  // fully assembled, placeholders substituted
  tools: ToolDefinition[];                // the complete tool schema sent to the model
  thinking_level: string;                 // "default" when unconfigured
  agent_state: string;                    // absolute path of the Agent State
  workspace: string;                      // absolute path of the Workspace
  source?: "subagent" | "schedule";       // session origin; absent = user-created
}

interface ToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;   // JSON Schema
}
```

On resume, the engine takes this Trace line as the runtime config — the model, system prompt and Workspace are immutable for the Session's lifetime. See [Sessions & Traces](/sessions-and-traces).

## model_msg: complete payloads

Seven content payloads, discriminated by `payload.type`. Shared optional fields: `stop_reason` (marks an abnormal terminal state) and `fidelity` (an opaque provider-fidelity payload, see below):

```ts
type Fidelity = Record<string, unknown>;  // opaque provider-fidelity payload (see below)

interface TextPayload {
  type: "text";
  role: "user" | "assistant";
  text: string;
  fidelity?: Fidelity;        // e.g. { phase } segment marker (GPT-5), { signature }
  stop_reason?: StopReason;
}

interface ThinkingPayload {
  type: "thinking";
  role: "assistant";
  thinking: string;
  fidelity?: Fidelity;        // required by some models to replay history
  stop_reason?: StopReason;
}

interface InlineThinkingPayload {
  type: "inline_thinking";
  role: "assistant";
  data: string;               // reasoning content in binary form
  mime_type: string;
  fidelity?: Fidelity;
  stop_reason?: StopReason;
}

interface ToolCallPayload {
  type: "tool_call";
  role: "assistant";
  name: string;
  arguments: string;          // arguments as a JSON string
  tool_call_id: string;
  fidelity?: Fidelity;
  stop_reason?: StopReason;
}

interface ToolCallOutputPayload {
  type: "tool_call_output";
  role: "user";
  output: string;
  images?: string[];          // data:<mime>;base64,… URLs (e.g. read_image results)
  tool_call_id: string;
  stop_reason?: StopReason;
}

interface ImageUrlPayload {
  type: "image_url";
  role: "user";
  image_url: string;          // web URL or base64 data URL
  stop_reason?: StopReason;
}

interface InlineDataPayload {
  type: "inline_data";
  role: "user" | "assistant";
  data: string;               // other binary content
  mime_type: string;
  fidelity?: Fidelity;
  stop_reason?: StopReason;
}
```

`tool_call` and `tool_call_output` pair strictly via `tool_call_id`; a turn's calls form one batch, and outputs are re-fed in the original call order (see [The Agent Loop](/agent-loop)).

## model_msg: streaming partials

Four `partial_*` payloads mirror their complete counterparts, carrying an `event_type` phase marker:

```ts
type StreamEventType = "start" | "delta" | "stop";

interface PartialTextPayload {
  type: "partial_text";
  role: "assistant";
  event_type: StreamEventType;
  text: string;                 // the text added by this fragment
  stop_reason?: StopReason;
}

interface PartialThinkingPayload {
  type: "partial_thinking";
  role: "assistant";
  event_type: StreamEventType;
  thinking: string;
  stop_reason?: StopReason;
}

interface PartialToolCallPayload {
  type: "partial_tool_call";
  role: "assistant";
  event_type: StreamEventType;
  name: string;
  arguments: string;            // incremental fragment of the arguments JSON
  tool_call_id: string;
  stop_reason?: StopReason;
}

interface PartialToolCallOutputPayload {
  type: "partial_tool_call_output";
  role: "user";
  event_type: StreamEventType;
  output: string;
  images?: string[];            // images are not incremental — one delta carries the whole set
  tool_call_id: string;
  stop_reason?: StopReason;
}
```

### The streaming discipline

Every streamed segment follows one timing rule, with the complete message immediately after the `stop`:

```text
partial_text(start) → partial_text(delta) → … → partial_text(stop) → text (complete)
                      └── concatenation of all deltas ≡ the complete message ──┘
                          (truncation applies to both alike)
```

Renderers can therefore paint deltas incrementally and swap in the complete message in place; the Trace records only complete messages, never fragments. Interface implementations close their structures internally and never leak an unclosed fragment upward. `PartialAggregator` (`aggregate.ts`) ships a ready-made aggregator.

## event_msg

Eight event payloads, all listed field by field:

```ts
interface RequestBeginPayload {
  type: "request_begin";
}

interface RequestEndPayload {
  type: "request_end";
  status: StopReason;         // "completed" is the mechanical commit criterion for replay
}

interface ApprovalDecisionPayload {
  type: "approval_decision";
  decision: "allow" | "deny";
  tool_call_id: string;       // pairs with the approved tool_call — the audit record
}

interface TokenUsagePayload {
  type: "token_usage";
  session: TokenCounts;       // Session cumulative
  request: TokenCounts;       // this Request
}

interface TokenCounts {
  cache_read: number;
  cache_write: number;
  output: number;
  total: number;
}

type CompactionReason = "context" | "turns" | "manual";
type CompactionMode = "summarize" | "discard";

interface CompactionBeginPayload {
  type: "compaction_begin";
  reason: CompactionReason;
  mode: CompactionMode;
  context: number;            // context tokens at trigger time
  turns: number;              // cumulative turns at trigger time
}

interface CompactionEndPayload {
  type: "compaction_end";
  reason: CompactionReason;
  mode: CompactionMode;
  status: StopReason;
}

interface AbortPayload {
  type: "abort";
  reason?: string | null;
}

interface SubagentPayload {
  type: "subagent";
  session_id: string;         // pointer in the parent Trace to a direct child Session
}
```

## stop_reason

A five-value enum used across messages and interface results (`LLMOutcome.status` uses the same set — see [Core Interfaces](/interfaces)):

```ts
type StopReason = "completed" | "failed" | "aborted" | "timeout" | "malformed";
```

| Value | Meaning | Engine reaction |
| --- | --- | --- |
| `completed` | finished normally | continue |
| `aborted` | user interrupt | stop, hand back to the user |
| `timeout` | LLM timeout / lost connection | LLM side only: auto-reconnect within the run |
| `malformed` | parse failure / truncated stream | LLM side only: auto-reconnect within the run |
| `failed` | other non-retryable error | stop, hand back to the user |

Errors never cross an interface boundary as exceptions — they *are* messages. See [The Agent Loop](/agent-loop).

## origin: the Subagent chain

`origin` serves Subagents: when a child Session's messages are forwarded to the parent, each hop prepends one child Session id (outer→inner), and renderers route messages into the right nested card by the chain:

```ts
// message from the main Session: no origin
{ timestamp: "…", type: "model_msg", payload: { type: "text", … } }

// message from a one-level Subagent: origin = [child Session id]
{ timestamp: "…", type: "model_msg", origin: ["session-2026-07-18-…-a1b2c3d4"], payload: { … } }
```

`origin`-tagged messages are not written to the parent Trace — the child Session has its own Trace, and the parent keeps only the `subagent` pointer event.

## Provider-fidelity fields

Provider-specific wire data travels in a single optional field, `fidelity` — an arbitrary JSON object the LLM client records to reproduce the original message on replay: thinking signatures, `phase` segment labels, GPT-5 encrypted reasoning, the OpenAI-compatible upstream reasoning field name:

```ts
// Claude: a thinking block closed by its signature
{ type: "thinking", thinking: "…", fidelity: { signature: "EqQBCkYIBxgCKkB…" } }

// GPT-5: encrypted reasoning (empty thinking text, fidelity only)
{ type: "thinking", thinking: "", fidelity: { id: "rs_0d3…", encrypted_content: "gAAAA…" } }

// OpenAI-compatible: the upstream field the reasoning text came from
{ type: "thinking", thinking: "…", fidelity: { reasoning_field: "reasoning_content" } }
```

The payload is opaque to PenguinHarness: it passes through and persists verbatim end to end — some models require it byte-for-byte when history is replayed, and any rewriting (or loss) would break compatibility. This is one of the preconditions for lossless Session recovery from the Trace.

## Three jobs, one protocol

| Surface | Subset used |
| --- | --- |
| SDK boundary (`session.run` output) | complete `model_msg` + streaming `partial_*` + all `event_msg` |
| Trace on disk | `session_meta` + complete `model_msg` + all `event_msg` (no partials, no `origin`-tagged messages) |
| Server SSE stream | same as the SDK boundary, verbatim single-line JSON — see [Server API](/server-api) |

How messages travel along these surfaces — and every ordering guarantee — is covered on [Message Flow & Ordering](/message-flow).

## Builders and guards

`@prismshadow/penguin-core` exports all types, a builder per message kind (`builders.ts`: `userText`, `assistantText`, `toolCall`, `toolCallOutput`, `partialText`, `tokenUsage`, `withOrigin`, `emptyTokenCounts`, `addTokenCounts`, …) and runtime guards (`isCompleteModelMessage`, `isPartialPayload`, `isModelMessage`, `isEventMessage`, `isSessionMeta`):

```ts
import { userText, isCompleteModelMessage } from "@prismshadow/penguin-core";

const prompt = userText("List the files in the current directory");
// { timestamp: "…", type: "model_msg", payload: { type: "text", role: "user", text: "…" } }
```
