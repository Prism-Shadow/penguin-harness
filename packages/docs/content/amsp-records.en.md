---
title: AMSP Records
description: The AMSP record is the one message format: the SDK yields it, the Trace stores it, and the Server streams it verbatim over SSE.
---

An AMSP record is PenguinHarness's one message format. The SDK yields records, the Trace stores them line by line, and the Server pushes them verbatim over SSE. What streams, what is stored, and what the model sees are one structure: there is no second format between front end, back end, and storage.

They are the records of [AMSP](/amsp), the stream the [Agent API](/agent-api) serves to programs outside PenguinHarness: every line of a Trace is a valid AMSP record, so a change to the records is a change to that public protocol.

This page starts with the envelope and its three message types, then lists every payload field by field, and ends with the rules that span every record: the streaming discipline, end reasons, `origin` and provider fidelity. The definitions live in `packages/amsp/src/records/` (the `@prismshadow/amsp` package, entry `@prismshadow/amsp/records`), and `@prismshadow/penguin-core` re-exports them from its root.

## The envelope

Every message shares one envelope. Only the `payload` varies:

```ts
interface AmspRecord<P extends AmspPayload = AmspPayload> {
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
  model_id: string;                       // the upstream request id sent to MMSP
  model_context_window: number | string;
  system_prompt: string;                  // fully assembled, placeholders substituted
  agent_state: string;                    // absolute path of the Agent State
  workspace: string;                      // absolute path of the Workspace
  source: "user" | "api" | "schedule" | "subagent" | "cli" | "company" | "workbench"; // what kind of conversation this is
}
```

The Workspace is fixed for the Session's lifetime. The model and the system prompt are fixed per context: an in-session model switch opens its new context on another model, and this record is the only place that says so.

`source` says what kind of conversation the Session is, and is fixed for its lifetime too:

- `user`: a person's conversation, the Web App's composer, `penguin chat` and forks included;
- `api`: one an external program opened through the Agent API;
- `schedule`: a scheduled task's run;
- `subagent`: a `run_subagent` child;
- `cli`: one `penguin run` created;
- `workbench`: a Session the Workbench host created for an application;
- `company`: a desk or ticket Session that [company mode](/company-mode) opened.

A Trace written by an older release may have no `source`, which reads as `user`, or as `company` when the server's index row says company mode opened the Session. It may also carry the retired `benchmark`, which reads as `cli`. The file itself is never rewritten.

Every Trace file opens with a `session_meta`. When a compaction opens a new context, the new file's `session_meta` carries the system prompt assembled for that context from the Agent State as it stands at that moment (see [Compaction](/agent-loop#compaction)). On resume, the engine takes the latest file's `session_meta` as the runtime configuration. See [Sessions & Traces](/sessions-and-traces).

The thinking level is not part of the meta. It is a per-request parameter: each request takes the Session's pinned level, which can change mid-context and applies from the next request, or, without a pin, the agent config default read when the context opened. Nothing records the level. A `thinking_level` field found in older Traces is displayed but never read back.

The tool schema is **not in the meta** either. The toolset is only known after the MCP Servers connect, and the meta must not wait for that. The full tool definitions arrive as a standalone `tool_list_ready` event (see [event_msg](#eventmsg)):

- at the first run;
- for every context a compaction opens, right after that context's `session_meta` at the head of its Trace file.

Traces written before this split embedded a `tools` field in the meta. That field is no longer read, and the tool record of those Traces is not displayed.

## model_msg: complete payloads

There are seven content payloads, discriminated by `payload.type`. One optional field is shared: `fidelity`, an opaque provider-fidelity payload (see [Provider-fidelity fields](#provider-fidelity-fields)). No content payload carries an end reason; a tool result carries its `status` (see [End reasons](#end-reasons)):

```ts
type Fidelity = Record<string, unknown>;  // opaque provider-fidelity payload (see below)

interface TextPayload {
  type: "text";
  role: "user" | "assistant";
  text: string;
  sender?: "user" | "parent_agent" | "harness" | "server"; // who produced a user-role text; absent = the human user
  fidelity?: Fidelity;        // e.g. { phase } segment marker (GPT-5), { signature }
}

interface ThinkingPayload {
  type: "thinking";
  role: "assistant";
  thinking: string;
  fidelity?: Fidelity;        // required by some models to replay history
}

interface InlineThinkingPayload {
  type: "inline_thinking";
  role: "assistant";
  data: string;               // reasoning content as base64-encoded bytes
  mime_type: string;
  fidelity?: Fidelity;
}

interface ToolCallPayload {
  type: "tool_call";
  role: "assistant";
  name: string;
  arguments: string;          // arguments as a JSON string
  tool_call_id: string;
  fidelity?: Fidelity;
}

interface ToolCallOutputPayload {
  type: "tool_call_output";
  role: "user";
  output: string;
  images?: string[];          // data:<mime>;base64,… URLs (e.g. read_file's image results)
  tool_call_id: string;
  status: ToolStatus;         // completed / aborted (denied, or interrupted while running) / fatal
}

interface ImageUrlPayload {
  type: "image_url";
  role: "user";
  image_url: string;          // web URL or base64 data URL
}

interface InlineDataPayload {
  type: "inline_data";
  role: "user" | "assistant";
  data: string;               // other binary content, base64-encoded
  mime_type: string;
  fidelity?: Fidelity;
}
```

`sender` separates the human user (`user`) from the parent agent driving a subagent (`parent_agent`), the harness's automatic injections such as background-task completion reports, stop-hook continues and user-prompt hook contexts (`harness`), and the server's own triggers such as scheduled tasks (`server`). It is never sent to the provider.

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
}

interface PartialThinkingPayload {
  type: "partial_thinking";
  role: "assistant";
  event_type: StreamEventType;
  thinking: string;
}

interface PartialToolCallPayload {
  type: "partial_tool_call";
  role: "assistant";
  event_type: StreamEventType;
  name: string;
  arguments: string;            // incremental fragment of the arguments JSON
  tool_call_id: string;
}

interface PartialToolCallOutputPayload {
  type: "partial_tool_call_output";
  role: "user";
  event_type: StreamEventType;
  output: string;
  images?: string[];            // images are not incremental — one delta carries the whole set
  tool_call_id: string;
}
```

### The streaming discipline

Every streamed segment follows one timing rule, and the complete message arrives immediately after the `stop`:

```text
partial_text(start) → partial_text(delta) → … → partial_text(stop) → text (complete)
                      └── concatenation of all deltas ≡ the complete message ──┘
                          (truncation applies to both alike)
```

Renderers can therefore paint deltas as they arrive and swap in the complete message in place. The Trace records only complete messages, never fragments. Interface implementations close their structures internally and never leak an unclosed fragment upward. Each run of fragments ends with its complete message after the `stop`, so a consumer never has to reassemble fragments itself. That holds for an item an interruption, a failure or a cut-off ended early, too: its complete record holds what arrived (a tool call's raw argument text, which may not parse). Whether it entered the model history is its Request's `request_end.status`. A tool call of a Request that did not complete ran only if its `approval_decision` came before that `request_end`; one closed early never runs.

## event_msg

Fourteen event payloads record the runtime events outside the model context:

| Event `type` | What it records |
| --- | --- |
| `tool_list_ready` | The complete tool schema sent to the model |
| `mcp_connect_begin` | The MCP Servers being contacted |
| `mcp_connect_end` | The overall connect status and the per-server results |
| `task_begin` | The start of a Task |
| `task_end` | The end of the Task the last `task_begin` opened |
| `request_begin` | The start of a model request, with the thinking level it went out at |
| `request_end` | The request's terminal status, plus the retry detail block (`error_code`, `error_message`, `attempt`, `retry_in_ms`) |
| `approval_decision` | An approval decision, paired with its `tool_call_id` |
| `token_usage` | Session-cumulative and per-request Token counts |
| `compaction_begin` | The trigger reason and mode, with the context tokens and turn count at trigger time |
| `compaction_end` | The reason, mode and terminal status of a compaction, plus the retry detail block |
| `abort` | A user interruption, or the Task stopped at its turn cap, and its cause code |
| `subagent` | A pointer in the parent Trace to a direct child Session |
| `hook` | A hook's answer: the hook point, name, decision and the hook's own record |

The vocabulary is closed: a record or field is added only when no existing record carries the fact and no reader can derive it. `task_begin` / `task_end` are one of its two stated exceptions (the other is `request_begin.thinking_level`). Before them no record said where a Task starts or whether it reached its end, and every reader derived both from the user's prompts.

The Session writes one pair around each Task: one prompt's run, followed by the `hook` records of the stop hooks it consults. A Task that a stop hook's `continue` drives, such as a goal round, gets a pair of its own. A manual compaction and a model switch are not Tasks and get none. The payload is the type alone. How the Task ended is read from the records inside the pair (`abort`, a terminal `request_end` or `compaction_end`), and who started it from its input. A Task that throws writes no `task_end`, so an unclosed `task_begin` means the Task never reached its end. Where the records sit in the Trace is covered under [Trace design](/sessions-and-traces#trace-design).

Every payload that reports a failure carries the same error pair: `error_code`, a stable machine-readable cause that render layers localize from, and `error_message`, the raw text of the failure, shown verbatim. The complete listing:

```ts
type ErrorCode =
  // abort causes (a user interruption, or the turn cap)
  | "user_abort"
  | "backoff_interrupted"
  | "compaction_interrupted"
  | "max_turns"               // the Task reached max_turns; error_message names the cap
  // LLM request failures (request_end / compaction_end)
  | "timeout"                 // idle timeout / connection went silent
  | "network"                 // transport drops, provider 429/5xx, and anything unclassifiable
  | "malformed"               // response failed parsing/validation, or the stream was truncated
  | "output_truncated"        // the response stopped at its output cap; retried, never committed
  | "auth"                    // the provider rejected the credentials
  | "rejected"                // a definitive provider 4xx rejection (params, quota; 408/429 excluded)
  | "image_rejected"          // a provider 4xx on an input holding images, retried with them replaced
  | "unsupported"             // a deterministic client-side rejection (fast mode without a fast tier)
  | "invalid_input"           // the input failed to assemble into a request
  // MCP connect failures (per-server results of mcp_connect_end)
  | "connect_failed"          // the server could not connect or list its tools
  | "mcp_needs_setup"         // not contacted: the vault lacks a key the entry references
  | "mcp_sign_in_required";   // not contacted: the entry needs an OAuth sign-in

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

interface TaskBeginPayload {
  type: "task_begin";         // the start of one Task, before everything it writes — its
                              // input included; written and streamed by the Session
}

interface TaskEndPayload {
  type: "task_end";           // the Task returned, however it ended (the records inside
                              // the pair say how); absent when the Task threw
}

interface RequestBeginPayload {
  type: "request_begin";
  thinking_level?: ThinkingLevelName; // the level sent: the Session's pin, else the context's
                                      // default; absent when none was sent, and on Traces
                                      // written before the field
}

interface RequestEndPayload {
  type: "request_end";
  status: StopReason;         // the one record of why the Request ended (see End reasons);
                              // "completed" is the mechanical commit criterion for replay
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
  error_code?: ErrorCode;     // user_abort / backoff_interrupted / compaction_interrupted /
                              // max_turns (the turn cap)
  error_message?: string;     // the turn cap's names the cap: "reached max turns (40)"
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
  hook: "stop" | "pre_tool_use"     // the hook point that fired (see the agent loop's hooks)
    | "user_prompt";                // user_prompt: only for a hook that failed
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

A server that is skipped rather than contacted, because its entry references a vault key the agent lacks or because it needs an OAuth sign-in, appears in `results` as `fatal` with `mcp_needs_setup` or `mcp_sign_in_required`; its `error_message` names the missing keys, never a value. See [Vault references](/tools#vault-references).

`compaction_end` never carries `retry_in_ms`: compaction retries are announced on the compaction request's own `request_end`, which stays in the Trace. Older Traces may still spell an MCP connect failure or an abandoned compaction as `failed`, and carry a per-server `error` field instead of the error pair.

## End reasons

No record carries a per-item end reason. Every streamed item has its complete record, one an interruption cut off included; whether it entered the model history is its Request's `request_end.status`; how the run ended is read from `abort` and the terminal `request_end` / `compaction_end`. Records written by older versions carry a `stop_reason` field on every model payload; it is no longer read.

A Request ends with a `StopReason`. `LLMOutcome.status` uses the same set (see [Core Interfaces](/interfaces)):

```ts
type StopReason = "completed" | "aborted" | "retryable" | "fatal";  // request_end, compaction_end, MCP connect results
type ToolStatus = "completed" | "aborted" | "fatal";                // tool_call_output
```

A status answers one question: should this be retried? The kind of failure rides on `error_code`, and its detail on `error_message`.

| `request_end.status` | Meaning | Engine reaction |
| --- | --- | --- |
| `completed` | finished normally; the turn is committed | continue |
| `aborted` | user interruption or cancellation | stop, emit an `abort` event, hand back to the user |
| `retryable` | a failure worth retrying: transport drops, idle timeouts, 408/429/5xx, malformed responses, a response that arrived whole but stopped at its output cap (`error_code: "output_truncated"`), and anything unclassifiable | reconnect within the run on the backoff ladder; an attempt stopped at its cap is not committed. When the retries run out, the last `request_end` (no `retry_in_ms`) is the terminal record |
| `fatal` | a failure no retry can fix: a definitive provider 4xx rejection (parameters, quota), rejected credentials, or a deterministic client-side rejection | stop the run and hand back to the user; no `abort` event follows, and the `request_end` is the terminal record |

A tool result's `status` says what the result is:

| `tool_call_output.status` | Meaning |
| --- | --- |
| `completed` | the tool ran to its end; whatever it reported is in the output. A command that ran completes whatever its exit status: a non-zero exit or a signal is the command's result, written on the output's last line (`[exit code: N]`, `[terminated by signal X]`) |
| `fatal` | the call failed: an unknown tool, unparseable arguments, a tool error, an execution-environment error, or a timeout. The error is fed back to the model, never retried |
| `aborted` | the call did not run to its end: the user, the command policy or a pre_tool_use hook denied it (`approval_decision` names who), or the user interrupted it while it ran (the output holds what it had produced, then the interruption note) |

A `tool_call_output` written before the field reads as `completed`. Older Traces may still carry the retired `request_end` values `failed`, `timeout`, `malformed` and `auth`. Replay only ever compares against `completed`, and renderers still display the old spellings.

The turn cap is no Request: when a Task reaches `max_turns`, the engine writes an `abort` with `error_code: "max_turns"` and ends the Task.

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

The [Agent API](/agent-api) streams the same messages as [AMSP](/amsp) records, with control frames around them and without the Web App's server events.

How messages travel along these surfaces, and every ordering guarantee, is covered on [Message Flow & Ordering](/message-flow).

## Builders and guards

`@prismshadow/amsp` exports every record type, plus the following, and `@prismshadow/penguin-core` re-exports all of it:

- a builder per message kind in `records/builders.ts`: `userText`, `assistantText`, `toolCall`, `toolCallOutput`, `partialText`, `tokenUsage`, `withOrigin`, `emptyTokenCounts`, `addTokenCounts`, and more;
- runtime guards: `isCompleteModelMessage`, `isPartialPayload`, `isModelMessage`, `isEventMessage`, `isSessionMeta`, `isTaskRecord`, and `lastNonTaskRecord`, which finds the record that decides whether a Trace file was closed by a compaction.

```ts
import { userText, isCompleteModelMessage } from "@prismshadow/amsp";

const prompt = userText("List the files in the current directory");
// { timestamp: "…", type: "model_msg", payload: { type: "text", role: "user", text: "…" } }
```
