---
title: AMSP
description: The Agent Message Stream Protocol — the event stream one run of an agent is served as through the Agent API, its grammar, every event, the errors and the versioning rule.
---

AMSP (Agent Message Stream Protocol) is the wire format of the [Agent API](/agent-api). Where [MMSP](https://www.npmjs.com/package/@prismshadow/mmsp) streams one model call, AMSP streams one run of an agent: one Task, with the model Requests it makes, the tools the agent runs and their results, approvals, compaction, errors and the final count of tokens, on a Session the caller continues by id. One run is one HTTP response.

AMSP is a projection of the Session's live stream: the server translates the [OmniMessage](/omni-message) records and server events a run produces, and forwards both the fragments and the complete items as the engine produced them. OmniMessage gains no field for it. The types are in `@prismshadow/amsp` (`packages/amsp/src/types.ts`), which the server's translator and the client share.

## Transport

- The run is `POST <Base URL>/agents/:projectId/:agentId/runs` with `Content-Type: application/json`, `Accept: text/event-stream` and, unless the agent allows keyless access, `Authorization: Bearer <key>`. The body is described in [The run request](/agent-api#the-run-request).
- The answer is `200` with `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache` and `X-Accel-Buffering: no`. Each event is one `data: <JSON>` block followed by a blank line; after the last event comes `data: [DONE]`. There are no `event:` or `id:` fields, so a dropped stream cannot be resumed.
- After 15 seconds without an event, the server writes the comment `: keep-alive`, so proxies and clients see the connection is alive while the model or a tool is slow.
- Every event carries `type` and `at` (ISO 8601, UTC). An event from a subagent's Session also carries `origin`, the chain of child Session ids from the outermost to the innermost, exactly as in OmniMessage; an event without `origin` belongs to the main Session.
- Bytes travel as base64 text: `inline_data.done.data`, `inline_thinking.done.data`, a tool result's `images`, and `data:` URLs in the input.
- A request refused before the stream gets an HTTP status and the error envelope; see [Errors](/agent-api#errors). Once the stream has started, an error is never a separate frame: `run.done` carries it.
- Routing is case-sensitive.

## Grammar

```text
stream       := run.started body* run.done
body         := context.opened | mcp_connect.started | mcp_connect.done | tools.ready
              | request | tool_result | approval | compaction | hook.fired
              | text.done (role user) | image_url.done
request      := request.started (item | tool_result | approval | hook.fired)* request.done
item         := K.delta* K.done              ; K = thinking | text | tool_call | inline_data | inline_thinking
tool_result  := tool_result.delta | tool_result.done   ; one event each: a result is tool_result.delta* tool_result.done,
                                                       ; keyed by tool_call_id, and may straddle request.done
approval     := approval.requested | approval.decided
compaction   := compaction.started (summary.delta* | summary.done)? compaction.done
```

The rules a client can rely on:

1. **Exactly one terminal.** `run.done` is the last event before `[DONE]`, whether the run completed, was aborted, failed, or the server failed while driving it (`status: "fatal"`, `error.code: "internal"`). A body that ends without it means the connection broke.
2. **Items close with `.done`, and fragments are never reconciled with it.** A `.done` item carries the whole content. The server forwards the fragments and the complete item as the engine produced them and rebuilds neither from the other. For text and thinking the fragments, concatenated, equal the `.done`; for a tool call they need not: the fragments are the provider's text as it streamed, and `tool_call.done.arguments` is the engine's serialization of the parsed call, so `{"command": "ls"}` may stream and `{"command":"ls"}` arrive done — both parse to the same object. A `.done` may arrive with no fragments before it. A streamed compaction summary is the one item without a `.done` (rule 7).
3. **One origin's model output is serial; tool results are not items.** Within one origin, the thinking, text, tool call and inline items come one after another: an item's `.done` precedes the next item's first fragment. Tool results, approvals and hook events may fall between any two events of an item, and the results of tools running in parallel interleave with each other; attribute them by `tool_call_id`. Different origins interleave freely; attribute by `origin`.
4. **A Request pair encloses its model output, not its tools.** The engine runs a tool as soon as its call is complete, while the Request is still open: the approval is asked and answered before that Request's `request.done`, the result starts as soon as the call is approved, usually before `request.done`, and may end after it. Every result of a Request's calls arrives before the next `request.started` of the same origin. A retried attempt is a new pair: `request.done` with `status: "retryable"` and `retry_in_ms`, then `request.started` again.
5. **Usage adds up.** `request.done.usage` is that attempt's count (`null` when there is none) and `compaction.done.usage` sums its attempts. `run.done.usage` is the sum of every `request.done.usage` and `compaction.done.usage` of the run; `run.done.session_usage` is the Session's running total as the engine last reported it, or `null`.
6. **Unknown types are ignored.** A client must skip an event `type` it does not know.
7. **Compaction holds only summaries.** Between `compaction.started` and `compaction.done` the only items are `summary.*`: the compaction's thinking is not forwarded, and `text.*` never appears. The engine streams a summary's fragments or delivers its text whole, never both, so a streamed summary is `summary.delta*` followed by `compaction.done` with no `summary.done`, and a whole one is a single `summary.done`. No `context.opened` follows a compaction: the context it opens is recorded in the Trace without being streamed. In practice `context.opened` marks a subagent's Session starting; the main Session streams one only on a model switch, which happens between runs.

## Events

Each event below also carries `at`, and `origin` when it comes from a subagent. Token counts are `{cache_read, cache_write, output, total}`; an error is `{code, message}`.

### Run

| Event | Fields | Meaning |
| --- | --- | --- |
| `run.started` | `session_id`, `agent` | First event: the Session the run is on (new or continued) and the agent, `<projectId>/<agentId>` |
| `run.done` | `status`, `error?`, `requests`, `usage`, `session_usage` | Last event: how the run ended, how many model Requests it issued (retried attempts included), its token count and the Session's |

`status` is `completed`, `aborted`, `retryable` or `fatal`, the same four values as OmniMessage's `stop_reason`. `error` is present when a Request or compaction failed for good, or the run was aborted.

### Context and setup

| Event | Fields | Meaning |
| --- | --- | --- |
| `context.opened` | `session_id`, `provider`, `model_id`, `context_window` | A new model context the engine streams: with `origin`, a subagent's Session starting; without, a model switch, which happens between runs. The context a compaction opens is not streamed |
| `mcp_connect.started` | `servers` | The agent's MCP servers start connecting |
| `mcp_connect.done` | `status`, `results`, `error?` | Each server's outcome: `{server, transport, status, duration_ms, tools?, error?}` |
| `tools.ready` | `tools` | The tool definitions the model is given: `{name, description, parameters?}` |

### Requests

| Event | Fields | Meaning |
| --- | --- | --- |
| `request.started` | `request` | A model Request begins; `request` counts from 1 within the run (a subagent counts its own) |
| `request.done` | `request`, `status`, `usage`, `error?`, `attempt?`, `retry_in_ms?` | It ended. `retry_in_ms` is present only when the engine will retry within the run |

### Items

| Event | Fields | Meaning |
| --- | --- | --- |
| `text.delta` | `role: "assistant"`, `text` | A fragment of the model's text; may be empty |
| `text.done` | `role`, `text`, `stop_reason`, `sender?` | A complete text. `role: "user"` is a message added during the run, such as steering or a hook's continuation, with `sender` saying who added it |
| `thinking.delta` / `thinking.done` | `thinking`, `stop_reason` on done | The model's thinking |
| `tool_call.delta` | `tool_call_id`, `name`, `arguments` | A fragment of a tool call: `name` is set on the first one, `arguments` is a piece of the text the provider streamed |
| `tool_call.done` | `tool_call_id`, `name`, `arguments`, `stop_reason` | The complete call; `arguments` is the engine's serialization of the parsed call as a JSON string |
| `tool_result.delta` | `tool_call_id`, `output`, `images?` | Output a running tool has produced so far, possibly before the Request's `request.done`; `images` arrive whole, in one fragment |
| `tool_result.done` | `tool_call_id`, `output`, `images?`, `stop_reason` | The tool's result as the model receives it; may follow the Request's `request.done`, always before the next `request.started` |
| `inline_data.done` | `role`, `mime_type`, `data`, `stop_reason` | An image or other data inline in the conversation, base64 |
| `inline_thinking.done` | `mime_type`, `data`, `stop_reason` | Opaque thinking data a provider returns, base64 |
| `image_url.done` | `role: "user"`, `image_url` | An image added to the conversation during the run |
| `summary.delta` / `summary.done` | `text`, `stop_reason` on done | The summary a compaction writes: streamed as fragments with no `.done`, or delivered whole as one `summary.done` |

`arguments` stays a string, unlike MMSP, which parses it. The fragments carry the provider's text as it streamed; `tool_call.done.arguments` is the engine's own serialization of the parsed call, also what the Trace keeps, so the two need not match character for character but parse to the same object. A call cut short (`stop_reason` other than `completed`) carries the text received so far. The client's `parseArguments` turns either into an object.

The run's own input is not repeated on the stream; `run.started` follows the request.

### Approvals

| Event | Fields | Meaning |
| --- | --- | --- |
| `approval.requested` | `tool_call: {tool_call_id, name, arguments}` | A tool call waits for an answer: `POST /sessions/:sessionId/approvals/:toolCallId` with `{"decision": "allow" \| "deny"}` |
| `approval.decided` | `tool_call_id`, `decision` | The decision on a tool call, for every call the model makes: by the approval mode, a hook, the caller or the Web App. `decision` is `allow`, `deny`, or `forbidden` when the command policy vetoed the call |

Only a call that waits is sent as `approval.requested`; one the approval mode settles goes straight to `approval.decided`. Answer a subagent's approval through the main Session's id, the one `run.started` named.

### Compaction and hooks

| Event | Fields | Meaning |
| --- | --- | --- |
| `compaction.started` | `reason`, `mode`, `context`, `turns` | Context compaction begins: `reason` is `context`, `turns` or `manual`, `mode` is `summarize` or `discard` |
| `compaction.done` | `reason`, `mode`, `status`, `usage`, `error?`, `attempt?` | It ended |
| `hook.fired` | `hook`, `name`, `decision?`, `reason?`, `output?` | A hook ran at `stop`, `pre_tool_use` or `user_prompt`, and what it decided |

## Examples

A plain answer:

```text
data: {"type":"run.started","at":"2026-10-07T10:00:00.000Z","session_id":"session-2026-10-07-10-00-00-3f9a1c2e","agent":"demo/coder"}
data: {"type":"request.started","at":"…","request":1}
data: {"type":"text.delta","at":"…","role":"assistant","text":""}
data: {"type":"text.delta","at":"…","role":"assistant","text":"Hello"}
data: {"type":"text.delta","at":"…","role":"assistant","text":"!"}
data: {"type":"text.done","at":"…","role":"assistant","text":"Hello!","stop_reason":"completed"}
data: {"type":"request.done","at":"…","request":1,"status":"completed","usage":{"cache_read":0,"cache_write":0,"output":2,"total":412}}
data: {"type":"run.done","at":"…","status":"completed","requests":1,"usage":{"cache_read":0,"cache_write":0,"output":2,"total":412},"session_usage":{"cache_read":0,"cache_write":0,"output":2,"total":412}}
data: [DONE]
```

Each event is followed by a blank line on the wire; the examples leave them out.

A tool call that waits for the caller's approval, then a second Request. The tool runs while the first Request is still open: the approval and the start of the result come before its `request.done`, the rest of the result after it. The streamed arguments are the provider's text; the `.done` carries the engine's serialization of the parsed call:

```text
data: {"type":"run.started",…}
data: {"type":"request.started","request":1,…}
data: {"type":"tool_call.delta","tool_call_id":"call_1","name":"exec_command","arguments":"",…}
data: {"type":"tool_call.delta","tool_call_id":"call_1","name":"","arguments":"{\"command\": \"ls\"}",…}
data: {"type":"tool_call.done","tool_call_id":"call_1","name":"exec_command","arguments":"{\"command\":\"ls\"}","stop_reason":"completed",…}
data: {"type":"approval.requested","tool_call":{"tool_call_id":"call_1","name":"exec_command","arguments":"{\"command\":\"ls\"}"},…}
            ← caller: POST /api/amsp/v1/sessions/<id>/approvals/call_1 {"decision":"allow"} → 204
data: {"type":"approval.decided","tool_call_id":"call_1","decision":"allow",…}
data: {"type":"tool_result.delta","tool_call_id":"call_1","output":"",…}
data: {"type":"request.done","request":1,"status":"completed","usage":{…},…}
data: {"type":"tool_result.delta","tool_call_id":"call_1","output":"README.md\nsrc\n",…}
data: {"type":"tool_result.done","tool_call_id":"call_1","output":"README.md\nsrc\n","stop_reason":"completed",…}
data: {"type":"request.started","request":2,…}
data: {"type":"text.delta",…} … data: {"type":"text.done","text":"Two entries: README.md and src.",…}
data: {"type":"request.done","request":2,"status":"completed","usage":{…},…}
data: {"type":"run.done","status":"completed","requests":2,"usage":{…},"session_usage":{…},…}
data: [DONE]
```

A compaction between two Requests. Its summary is streamed, so it has no `summary.done`, and no `context.opened` follows:

```text
data: {"type":"request.done","request":1,"status":"completed","usage":{…},…}
data: {"type":"compaction.started","reason":"context","mode":"summarize","context":300,"turns":1,…}
data: {"type":"summary.delta","text":"",…}
data: {"type":"summary.delta","text":"Summary.",…}
data: {"type":"compaction.done","reason":"context","mode":"summarize","status":"completed","usage":{…},"attempt":1,…}
data: {"type":"request.started","request":2,…}
```

A transient failure and its retry, then the caller aborts:

```text
data: {"type":"run.started",…}
data: {"type":"request.started","request":1,…}
data: {"type":"request.done","request":1,"status":"retryable","usage":null,"error":{"code":"network","message":"fetch failed"},"attempt":1,"retry_in_ms":1000,…}
: keep-alive
data: {"type":"request.started","request":2,…}
data: {"type":"text.delta","text":"Let me",…}
            ← caller: POST /api/amsp/v1/sessions/<id>/abort → 202
data: {"type":"text.done","text":"Let me","stop_reason":"aborted",…}
data: {"type":"request.done","request":2,"status":"aborted","usage":null,"attempt":2,…}
data: {"type":"run.done","status":"aborted","error":{"code":"user_abort","message":"…"},"requests":2,"usage":{…},"session_usage":null,…}
data: [DONE]
```

## Errors in the stream

`run.done.status` says how the run ended: `aborted` when it was aborted; otherwise the status of the Request or compaction that failed for good, with its error; `fatal` without an error when the run reached the agent's turn limit; `completed` otherwise. `run.done.error.code` takes the same codes OmniMessage records, plus two of AMSP's own:

| `code` | Meaning |
| --- | --- |
| `user_abort` | The run was aborted: by `POST …/abort`, the caller disconnecting, or someone in the Web App |
| `backoff_interrupted`, `compaction_interrupted` | An abort arrived while the engine waited to retry, or during a compaction |
| `timeout` | The model's connection went silent |
| `network` | A dropped connection, a provider `429` or `5xx`, or a failure that fits nowhere else |
| `malformed` | The model's response failed to parse or was cut short |
| `auth` | The provider refused the credentials |
| `rejected` | The provider refused the request for good (parameters, quota) |
| `context_overflow` | The request was larger than the model's context window |
| `image_rejected` | The provider refused an image in the request. An image in the turn's input is replaced with a note and the request retried at once (`retryable` with `retry_in_ms: 0`); the run ends on it only when the refused image is already in the conversation's history |
| `unsupported` | The request asked for something the model cannot do |
| `invalid_input` | The input could not be assembled into a request |
| `connect_failed` | An MCP server failed to connect (on `mcp_connect.done`) |
| `internal` | The server failed while driving the run |
| `session_rebuilt` | The server had to rebuild the Session under a new id and could not follow it; the message names the new id |

A run that ends `fatal` or `retryable` is still answered `200`: the HTTP status only covers the request itself.

## From OmniMessage to AMSP

The server's translator reads what the Session publishes while it runs and writes AMSP events:

| OmniMessage record or server event | AMSP |
| --- | --- |
| Anything the Session published before the run's input (an idle `task_state` a subagent's state change re-published, a background subagent's output) | Not sent: the translator starts at the input's echo |
| The run's own input | Not sent |
| `session_meta` | `context.opened`: a subagent's, or a model switch's between runs; the context a compaction opens is written to the Trace only |
| `mcp_connect_begin` / `mcp_connect_end` | `mcp_connect.started` / `mcp_connect.done` |
| `tool_list_ready` | `tools.ready` |
| `request_begin` / `request_end` | `request.started` / `request.done` |
| `token_usage` | Not sent: its counts go on the next `request.done` (or `compaction.done`), and its Session total on `run.done` |
| `partial_text`, `partial_thinking`, `partial_tool_call`, `partial_tool_call_output`, at `start` and `delta` | `text.delta`, `thinking.delta`, `tool_call.delta`, `tool_result.delta`; inside a compaction, text is `summary.delta` (no `summary.done` follows it) and thinking is not sent |
| A `partial_*` at `stop` | Not sent |
| `text`, `thinking`, `tool_call`, `tool_call_output` | `text.done`, `thinking.done`, `tool_call.done`, `tool_result.done`; inside a compaction, a text the engine delivered whole is `summary.done` and thinking is not sent |
| `inline_data`, `inline_thinking`, `image_url` | `inline_data.done`, `inline_thinking.done`, `image_url.done` |
| The `approval_request` server event / `approval_decision` | `approval.requested` / `approval.decided` |
| `compaction_begin` / `compaction_end` | `compaction.started` / `compaction.done` |
| `hook` | `hook.fired` |
| `abort` | Not sent: it makes `run.done` `aborted` with its error |
| The `task_state` server event turning `idle` | `run.done` |

Fields that serve only the Trace, such as provider `fidelity` and `session_meta.source`, are not carried: an API run's Session is an API Session by construction.

## Versioning

- The version is in the path, `/api/amsp/v1`; events carry none.
- Within `/v1`, changes only add: new event types and new optional fields. A client that ignores what it does not know keeps working.
- A change to what an existing field means is a new version, `/v2`, served beside `/v1`.
- Event names are `<subject>.<phase>`; items are `K.delta` and `K.done`, as in MMSP. A "run" on the wire is one Task in PenguinHarness's terms.

## Reading the stream yourself

Any SSE reader works, as long as it can send `Authorization` and a POST body: use `fetch`, not `EventSource`. Read it the way an `EventSource` would: lines end in LF, CRLF or a lone CR; a blank line ends an event; lines starting with `:` are comments; the `data:` lines of one event join with a newline; stop at `data: [DONE]`. `readSse` from `@prismshadow/amsp` does exactly this for a `fetch` body and yields each event's data.
