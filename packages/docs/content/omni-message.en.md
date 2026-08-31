---
title: The OmniMessage Protocol
description: One envelope, three message types, a six-value stop_reason — the unified protocol behind the SDK, the Trace and SSE, field by field.
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
  thinking_level?: ThinkingLevelName | "default"; // the level this context OPENED with ("default" = none); absent on older Traces
  agent_state: string;                    // absolute path of the Agent State
  workspace: string;                      // absolute path of the Workspace
  source?: "subagent" | "schedule";       // session origin; absent = user-created
}
```

session_meta describes **one model context**: the model and the Workspace are immutable for the Session's lifetime, while the system prompt is fixed per context — the file a compaction's rotation opens starts with a `session_meta` carrying the prompt assembled for the new context from the Agent State as it is then (see [Compaction](/agent-loop)); on resume, the engine takes the latest file's line as the runtime config. See [Sessions & Traces](/sessions-and-traces). `thinking_level` records what the context OPENED with. The level itself is the soft-limited runtime parameter — a Session pin applies from the next request, mid-context — so on resume the recorded value rebuilds the opening prefix, the host's pin (restored from its own store) rides the requests, and a meta from before the field existed resolves the level as a new context would.

The tool schema is **not in the meta**: the toolset is only known after MCP Servers connect, and the meta must not wait for that — the full tool definitions arrive as a standalone `tool_list_ready` event at the first run and, for every context a compaction opens, right after that context's `session_meta` at the head of its Trace file (see event_msg). Pre-split Traces embedded a `tools` field here; that field is explicitly no longer read (their tool record is not displayed).

## model_msg: complete payloads

Seven content payloads, discriminated by `payload.type`. Shared optional fields: `stop_reason` (marks an abnormal terminal state) and `fidelity` (an opaque provider-fidelity payload, see below):

```ts
type Fidelity = Record<string, unknown>;  // opaque provider-fidelity payload (see below)

interface TextPayload {
  type: "text";
  role: "user" | "assistant";
  text: string;
  sender?: "user" | "parent_agent" | "harness" | "server"; // who produced a user-role text; absent = the human user
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

Eleven event payloads, all listed field by field:

```ts
interface ToolListReadyPayload {
  type: "tool_list_ready";
  tools: ToolDefinition[];    // the complete tool schema sent to the model; emitted once
                              // at the first run (after MCP discovery), written to the
                              // Trace right after the run's input (it belongs to the new
                              // turn), and rewritten with session_meta at the head of
                              // each post-compaction Trace file
}

interface ToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;   // JSON Schema
}

interface McpConnectBeginPayload {
  type: "mcp_connect_begin";
  servers: string[];          // the MCP Servers being contacted; emitted only when
                              // mcpServers is configured — frontends show a connecting status
}

type McpConnectStatus = "completed" | "failed" | "aborted";

interface McpConnectEndPayload {
  type: "mcp_connect_end";
  status: McpConnectStatus;   // overall terminal status (compaction_end-style): completed
                              // (all connected) / failed (some server failed) / aborted
                              // (user interrupted — the attempt is cancelled and the next
                              // run reconnects from scratch)
  results: McpServerConnectResult[];
                              // the phase's total wall time is the end/begin messages'
                              // timestamp difference (messages carry their own timestamps;
                              // the payload holds no duplicate duration); empty on aborted
}

interface McpServerConnectResult {
  server: string;
  transport: "stdio" | "http" | "sse";
  status: McpConnectStatus;   // per-server and non-fatal: a failed server is skipped and
                              // the run continues
  duration_ms: number;        // this server's own connect + discovery time (no per-server
                              // messages exist to derive it from)
  tools?: number;             // tools discovered (on completed)
  error?: string;             // failure detail (on failed)
}

interface RequestBeginPayload {
  type: "request_begin";
}

interface RequestEndPayload {
  type: "request_end";
  status: StopReason;         // "completed" is the mechanical commit criterion for replay
  // The unified RetryDetail block below is stamped in one place by the builders; every
  // field is additive — old Traces replay unchanged. compaction_end reuses the same
  // block (attempt = final attempt ordinal, error_message = the last failure's detail).
  error_message?: string;     // error detail (LLMOutcome.errorMessage internally — one
                              // name across the stack), non-completed only: the real
                              // reason behind a retried/failed Request (e.g. a provider
                              // error code) — read by the Cost center's errors panel
  attempt?: number;           // 1-based ordinal of this request within its retry run (the
                              // authoritative retry count): stamped on failures and on a
                              // completion that needed retries; absent on a clean first try
  retry_in_ms?: number;       // planned reconnect wait (ms), present only when the engine
                              // will retry in-run — the Web App renders it as a countdown
}

interface ApprovalDecisionPayload {
  type: "approval_decision";
  decision: "allow" | "deny" | "forbidden"; // "forbidden" = the command policy's veto,
                              // never asked of a human — the record itself names the decider
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

A six-value enum used across messages and interface results (`LLMOutcome.status` uses the same set — see [Core Interfaces](/interfaces)):

```ts
type StopReason = "completed" | "failed" | "aborted" | "timeout" | "malformed" | "auth";
```

| Value | Meaning | Engine reaction |
| --- | --- | --- |
| `completed` | finished normally | continue |
| `aborted` | user interrupt | stop, hand back to the user |
| `timeout` | LLM timeout / transport disconnect | LLM side only: auto-reconnect within the run |
| `malformed` | parse failure / truncated stream | LLM side only: auto-reconnect within the run |
| `failed` | an error the classifier did not judge transient (LLM); a tool error (Environment) | LLM side: auto-reconnect within the run as well — the status is still reported as `failed`. Environment side: the error is fed back to the model, never retried |
| `auth` | the provider rejected the credentials | stop, hand back to the user — the one LLM status that never retries; hosts gate input until the model's API key is updated (credentials come from the current Project config) |

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
