---
title: The OmniMessage Protocol
description: OmniMessage is the unified message protocol that the SDK yields, the Trace stores, and the Server streams verbatim over SSE.
---

OmniMessage is PenguinHarness's unified message protocol. The SDK yields OmniMessage objects, the Trace stores them line by line, and the Server pushes them verbatim over SSE. What streams, what is stored, and what the model sees are one structure: there is no second format between front end, back end, and storage.

This page starts with the envelope and its three message types, then lists every payload field by field, and ends with the rules that span the whole protocol: the streaming discipline, `stop_reason`, `origin` and provider fidelity. The type definitions live in `packages/core/src/omnimessage/types.ts`.

## The envelope

Every message shares one envelope. Only the `payload` varies:

```ts
interface OmniMessage<P extends OmniPayload = OmniPayload> {
  timestamp: string;        // ISO 8601 UTC
  type: "session_meta" | "model_msg" | "event_msg";
  payload: P;
  origin?: string[];        // child-Session chain (outer→inner); absent = main Session
}
```

Each `type` carries different content:

| type | Meaning | Volume |
| --- | --- | --- |
| `session_meta` | The full runtime configuration of one model context | exactly one per context |
| `model_msg` | Content inside the model context (text, thinking, tool calls and results) | the bulk |
| `event_msg` | Runtime events outside the context (approvals, usage, compaction, aborts, hook answers) | alongside |

The optional `origin` field routes Subagent messages. See [origin: the Subagent chain](#origin-the-subagent-chain).

## session_meta

A `session_meta` message describes **one model context**:

```ts
interface SessionMetaPayload {
  session_id: string;
  provider: string;                       // one half of the model-identity pair
  model_id: string;                       // the upstream request id sent to AgentHub
  model_context_window: number | string;
  system_prompt: string;                  // fully assembled, placeholders substituted
  agent_state: string;                    // absolute path of the Agent State
  workspace: string;                      // absolute path of the Workspace
  source?: "subagent" | "schedule" | "benchmark"; // spawned by a subagent / a scheduled task / a Benchmark run; absent = user-created
}
```

The Workspace is fixed for the Session's lifetime. The model and the system prompt are fixed per context: an in-session model switch opens its new context on another model, and this record is the only place that says so.

Every Trace file opens with a `session_meta`. When a compaction opens a new context, the new file's `session_meta` carries the system prompt assembled for that context from the Agent State as it stands at that moment (see [Compaction](/agent-loop#compaction)). On resume, the engine takes the latest file's `session_meta` as the runtime configuration. See [Sessions & Traces](/sessions-and-traces).

The thinking level is not part of the meta. It is a per-request parameter: each request takes the Session's pinned level, which can change mid-context and applies from the next request, or, without a pin, the agent config default read when the context opened. Nothing records the level. A `thinking_level` field found in older Traces is displayed but never read back.

The tool schema is **not in the meta** either. The toolset is only known after the MCP Servers connect, and the meta must not wait for that. The full tool definitions arrive as a standalone `tool_list_ready` event (see [event_msg](#eventmsg)):

- at the first run;
- for every context a compaction opens, right after that context's `session_meta` at the head of its Trace file.

Traces written before this split embedded a `tools` field in the meta. That field is no longer read, and the tool record of those Traces is not displayed.

## model_msg: complete payloads

There are seven content payloads, discriminated by `payload.type`. Two optional fields are shared: `stop_reason` marks an abnormal terminal state (see [stop_reason](#stopreason)), and `fidelity` is an opaque provider-fidelity payload (see [Provider-fidelity fields](#provider-fidelity-fields)):

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
  data: string;               // reasoning content as base64-encoded bytes
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
  images?: string[];          // data:<mime>;base64,… URLs (e.g. read_file's image results)
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
  data: string;               // other binary content, base64-encoded
  mime_type: string;
  fidelity?: Fidelity;
  stop_reason?: StopReason;
}
```

`sender` separates the human user (`user`) from the parent agent driving a subagent (`parent_agent`), the harness's automatic injections such as background-task completion reports and hook continues (`harness`), and the server's own triggers such as scheduled tasks (`server`). It is never sent to the provider.

`tool_call` and `tool_call_output` pair strictly via `tool_call_id`. The calls of a turn form one batch, and outputs are re-fed in the original call order (see [The Agent Loop](/agent-loop)).

## model_msg: streaming partials

Four `partial_*` payloads mirror their complete counterparts. Each carries an `event_type` phase marker:

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

Every streamed segment follows one timing rule, and the complete message arrives immediately after the `stop`:

```text
partial_text(start) → partial_text(delta) → … → partial_text(stop) → text (complete)
                      └── concatenation of all deltas ≡ the complete message ──┘
                          (truncation applies to both alike)
```

Renderers can therefore paint deltas as they arrive and swap in the complete message in place. The Trace records only complete messages, never fragments. Interface implementations close their structures internally and never leak an unclosed fragment upward. `PartialAggregator` (`aggregate.ts`) is a ready-made aggregator.

## event_msg

Twelve event payloads record the runtime events outside the model context:

| Event `type` | What it records |
| --- | --- |
| `tool_list_ready` | The complete tool schema sent to the model |
| `mcp_connect_begin` | The MCP Servers being contacted |
| `mcp_connect_end` | The overall connect status and the per-server results |
| `request_begin` | The start of a model request |
| `request_end` | The request's terminal status, plus the retry detail block (`error_code`, `error_message`, `attempt`, `retry_in_ms`) |
| `approval_decision` | An approval decision, paired with its `tool_call_id` |
| `token_usage` | Session-cumulative and per-request Token counts |
| `compaction_begin` | The trigger reason and mode, with the context tokens and turn count at trigger time |
| `compaction_end` | The reason, mode and terminal status of a compaction, plus the retry detail block |
| `abort` | A user interruption and its cause code |
| `subagent` | A pointer in the parent Trace to a direct child Session |
| `hook` | A hook's answer: the hook point, name, decision and the hook's own record |

Every payload that reports a failure carries the same error pair: `error_code`, a stable machine-readable cause that render layers localize from, and `error_message`, the raw text of the failure, shown verbatim. The complete listing:

```ts
type ErrorCode =
  // abort causes (a user interruption, the only thing an abort event marks)
  | "user_abort"
  | "backoff_interrupted"
  | "compaction_interrupted"
  // LLM request failures (request_end / compaction_end)
  | "timeout"                 // idle timeout / connection went silent
  | "network"                 // transport drops, provider 429/5xx, and anything unclassifiable
  | "malformed"               // response failed parsing/validation, or the stream was truncated
  | "auth"                    // the provider rejected the credentials
  | "rejected"                // a definitive provider 4xx rejection (params, quota; 408/429 excluded)
  | "unsupported"             // a deterministic client-side rejection (fast mode without a fast tier)
  | "invalid_input"           // the input failed to assemble into a request
  // MCP connect failures
  | "connect_failed";

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

interface McpConnectEndPayload {
  type: "mcp_connect_end";
  status: StopReason;         // overall terminal status: completed (all connected) / fatal
                              // (some server failed; nothing retries it within the run) /
                              // aborted (user interrupted — the attempt is cancelled and
                              // the next run reconnects from scratch)
  results: McpServerConnectResult[];
                              // the phase's total wall time is the end/begin messages'
                              // timestamp difference (messages carry their own timestamps;
                              // the payload holds no duplicate duration); empty on aborted
  error_code?: ErrorCode;
  error_message?: string;
}

interface McpServerConnectResult {
  server: string;
  transport: "stdio" | "http" | "sse";
  status: StopReason;         // completed / fatal / aborted — per-server and non-fatal to
                              // the run: a failed server is skipped and the run continues
  duration_ms: number;        // this server's own connect + discovery time (no per-server
                              // messages exist to derive it from)
  tools?: number;             // tools discovered (on completed)
  error_code?: ErrorCode;     // failure cause and detail (on fatal)
  error_message?: string;
}

interface RequestBeginPayload {
  type: "request_begin";
}

interface RequestEndPayload {
  type: "request_end";
  status: StopReason;         // "completed" is the mechanical commit criterion for replay
  // The unified RetryDetail block below is stamped in one place by the builders; every
  // field is additive — old Traces replay unchanged. compaction_end reuses the same block.
  error_code?: ErrorCode;     // classified cause, non-completed only
  error_message?: string;     // error detail (LLMOutcome.errorMessage internally — one
                              // name across the stack), non-completed only: the real
                              // reason behind a retried/failed Request (e.g. a provider
                              // error code) — read by the Cost center's errors panel
  attempt?: number;           // 1-based ordinal of this request within its retry run (the
                              // authoritative retry count): stamped on failures and on a
                              // completion that needed retries; absent on a clean first try
  retry_in_ms?: number;       // planned reconnect wait (ms), present only when the engine
                              // will retry in-run — the Web App renders it as a countdown;
                              // a failed request_end without it is the run's terminal record
}

interface ApprovalDecisionPayload {
  type: "approval_decision";
  decision: "allow" | "deny" | "forbidden"; // "forbidden" = the command policy's veto,
                              // never asked of a human — the record itself names the decider
  tool_call_id: string;       // pairs with the approved tool_call — the audit record
}

interface TokenUsagePayload {
  type: "token_usage";
  session: TokenCounts;       // Session cumulative — authored by the engine (the LLM reports `request` only)
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
  status: StopReason;         // completed / retryable (abandoned after the retries ran out;
                              // the standing trigger makes it up) / fatal (a failure no
                              // retry can fix) / aborted (user interrupted); any status
                              // but completed keeps the original context
  attempt?: number;           // the final attempt's ordinal, failed attempts included
  error_code?: ErrorCode;     // the last failure's cause and detail
  error_message?: string;
}

interface AbortPayload {
  type: "abort";
  error_code?: ErrorCode;     // user_abort / backoff_interrupted / compaction_interrupted
  error_message?: string;
  reason?: string | null;     // legacy: older Traces carry the cause as English prose here;
                              // the engine no longer writes it
}

interface SubagentPayload {
  type: "subagent";
  session_id: string;         // pointer in the parent Trace to a direct child Session
                              // (written to the Trace, not streamed)
}

interface HookPayload {
  type: "hook";
  hook: "stop" | "pre_tool_use";    // the hook point that fired (see the agent loop's hooks)
  name: string;               // the hook's name: "goal", "continual-learning", …
  decision?: "continue" | "stop"    // stop point
    | "allow" | "deny";             // pre_tool_use point; absent when the hook only left a record
  reason?: string;            // one line for people
  output?: Record<string, string | number | boolean>;
                              // the hook's own record — the goal hook writes status /
                              // round / tokens_used / budget, the continual-learning hook
                              // session_id / turns; a continue's injected input is NOT
                              // here: it is the user message that follows
}
```

`compaction_end` never carries `retry_in_ms`: compaction retries are announced on the compaction request's own `request_end`, which stays in the Trace. Older Traces may still spell an MCP connect failure or an abandoned compaction as `failed`, and carry a per-server `error` field instead of the error pair.

## stop_reason

A four-value enum shared by every record that carries a stop reason: model messages, tool results, and request, compaction and MCP-connect terminals. `LLMOutcome.status` uses the same set (see [Core Interfaces](/interfaces)):

```ts
type StopReason = "completed" | "aborted" | "retryable" | "fatal";
```

A stop reason answers one question: should this be retried? The kind of failure rides on `error_code`, and its detail on `error_message`.

| Value | Meaning | Engine reaction |
| --- | --- | --- |
| `completed` | finished normally | continue |
| `aborted` | user interruption or cancellation | stop, emit an `abort` event, hand back to the user |
| `retryable` | a failure worth retrying: transport drops, idle timeouts, 408/429/5xx, malformed or truncated responses, and anything unclassifiable | LLM side: reconnect within the run on the backoff ladder |
| `fatal` | a failure no retry can fix. LLM side: a definitive provider 4xx rejection (parameters, quota), rejected credentials, or a deterministic client-side rejection. Environment side: a tool error or timeout | LLM side: stop the run and hand back to the user; no `abort` event follows, and the `request_end` is the terminal record. Environment side: the error is fed back to the model, never retried |

Tools rarely end `retryable`: a tool error or timeout is definitive for that call, and nothing in the harness retries a tool. Older Traces may still carry the retired values `failed`, `timeout`, `malformed` and `auth`. Replay only ever compares against `completed`, and renderers still display the old spellings.

Errors never cross an interface boundary as exceptions. They *are* messages (see [The Agent Loop](/agent-loop)).

## origin: the Subagent chain

`origin` serves Subagents. When a child Session's messages are forwarded to the parent, each hop prepends one child Session id, ordered outer to inner. Renderers read the chain to route each message into the right nested card:

```ts
// message from the main Session: no origin
{ timestamp: "…", type: "model_msg", payload: { type: "text", … } }

// message from a one-level Subagent: origin = [child Session id]
{ timestamp: "…", type: "model_msg", origin: ["session-2026-07-18-…-a1b2c3d4"], payload: { … } }
```

Messages tagged with `origin` are not written to the parent Trace. The child Session has its own Trace, and the parent keeps only the `subagent` pointer event.

## Provider-fidelity fields

Provider-specific wire data travels in a single optional field, `fidelity`. It is an arbitrary JSON object that the LLM client records so the original message can be reproduced on replay, for example:

- thinking signatures;
- `phase` segment labels;
- GPT-5 encrypted reasoning;
- the OpenAI-compatible upstream reasoning field name.

```ts
// Claude: a thinking block closed by its signature
{ type: "thinking", thinking: "…", fidelity: { signature: "EqQBCkYIBxgCKkB…" } }

// GPT-5: encrypted reasoning (empty thinking text, fidelity only)
{ type: "thinking", thinking: "", fidelity: { id: "rs_0d3…", encrypted_content: "gAAAA…" } }

// OpenAI-compatible: the upstream field the reasoning text came from
{ type: "thinking", thinking: "…", fidelity: { reasoning_field: "reasoning_content" } }
```

The payload is opaque to PenguinHarness: it passes through and persists verbatim end to end. Some models require it byte for byte when history is replayed, so any rewriting or loss breaks compatibility. This is one of the preconditions for lossless Session recovery from the Trace.

## Surfaces and their message subsets

| Surface | Subset used |
| --- | --- |
| SDK boundary (`session.run` output) | complete `model_msg` + streaming `partial_*` + all `event_msg` |
| Trace on disk | `session_meta` + complete `model_msg` + all `event_msg` (no partials, no `origin`-tagged messages) |
| Server SSE stream | same as the SDK boundary, verbatim single-line JSON — see [Server API](/server-api) |

How messages travel along these surfaces, and every ordering guarantee, is covered on [Message Flow & Ordering](/message-flow).

## Builders and guards

`@prismshadow/penguin-core` exports all protocol types, plus:

- a builder per message kind in `builders.ts`: `userText`, `assistantText`, `toolCall`, `toolCallOutput`, `partialText`, `tokenUsage`, `withOrigin`, `emptyTokenCounts`, `addTokenCounts`, and more;
- runtime guards: `isCompleteModelMessage`, `isPartialPayload`, `isModelMessage`, `isEventMessage`, `isSessionMeta`.

```ts
import { userText, isCompleteModelMessage } from "@prismshadow/penguin-core";

const prompt = userText("List the files in the current directory");
// { timestamp: "…", type: "model_msg", payload: { type: "text", role: "user", text: "…" } }
```
