---
title: AMSP
description: The Agent Message Stream Protocol — a Session's records over SSE, the control frames, the run and Session streams, the approvals resource, how a run's result is read, and the earlier v1 events each record replaces.
---

AMSP (Agent Message Stream Protocol) is the wire format of the [Agent API](/agent-api). It streams one Session: the Session's records exactly as its Trace holds them, the `partial_*` fragments streamed while a message is produced, and around them the `ping` heartbeat and, on a run stream, a closing `data: [DONE]`. Nothing is translated on the way: every line of a Trace is a valid AMSP record, and each payload is the one described field by field on the [AMSP Records](/amsp-records) page.

The Web App's server events (run state, approval requests, titles, goal progress and the rest) are not part of AMSP. A program reads what it needs from the records and from two resources: the Session, `GET …/sessions/:sessionId`, for its status and model, and its pending approvals, `GET …/sessions/:sessionId/approvals`.

The types are in `@prismshadow/amsp`, which `@prismshadow/penguin-core` re-exports; see [The amsp client](/agent-api#the-amsp-client).

## Transport

- A stream is `text/event-stream; charset=utf-8`, sent with `Cache-Control: no-cache` and `X-Accel-Buffering: no`. Each event is a few SSE fields followed by a blank line.
- Every event is one of two kinds, told apart by its `event:` name:
  - a **record** has no name. It has an `id:`, `<epoch>-<seq>`, and its `data:` is one record envelope as single-line JSON, `{timestamp, type, payload, origin?}`;
  - a **control frame** has a name and no `id:`, so it moves no resume position and is never buffered or replayed.
- Ids increase within a stream but need not be consecutive: the server's channel also numbers events AMSP does not carry. The epoch changes when the server restarts or recreates the Session's channel.
- Payloads are snake_case, exactly as the Trace stores them, provider `fidelity` included. Bytes travel as base64 text: `inline_data.data`, `inline_thinking.data`, a tool output's `images`, and `data:` URLs.
- A request refused before its stream starts gets an HTTP status and the error envelope; see [Errors](/agent-api#errors). Once a stream has started, there is no error frame.
- Routing is case-sensitive.

## Records

| Outer `type` | `payload.type` | Kept in the Trace |
| --- | --- | --- |
| `session_meta` | — | Yes |
| `model_msg` | `text`, `image_url`, `inline_data`, `thinking`, `inline_thinking`, `tool_call`, `tool_call_output` | Yes |
| `model_msg` | `partial_text`, `partial_thinking`, `partial_tool_call`, `partial_tool_call_output` | No: stream only |
| `event_msg` | `task_begin`, `task_end`, `request_begin`, `request_end`, `token_usage`, `compaction_begin`, `compaction_end`, `mcp_connect_begin`, `mcp_connect_end`, `tool_list_ready`, `approval_decision`, `hook`, `abort` | Yes |

The rules a reader can rely on:

1. **Dispatch on the event name.** An unnamed event is a record. A name the reader does not know is ignored, and so is a `payload.type` it does not know.
2. **Fragments, then the complete message.** A streamed message is `partial_*` with `event_type: "start"`, any number of `delta`, then `stop`; the complete message follows and replaces them. The two are never reconciled. For text and thinking, the deltas concatenated equal the complete message. A tool call's deltas are the provider's text as it streamed, while the complete `tool_call.arguments` is the engine's serialization of the parsed call, so `{"command": "ls"}` may stream and `{"command":"ls"}` arrive complete; both parse to the same object. A complete message may arrive with no fragments before it, and a reader that joins mid-stream drops a `delta` whose `start` it never saw.
3. **One origin's model output is serial; tool results are not.** Within one `origin`, thinking, text and tool calls come one after another. Tool outputs, approval decisions and hook records may fall between any two records of a message, and the outputs of tools running in parallel interleave; attribute them by `tool_call_id`. Different origins interleave freely; attribute by `origin`.
4. **A Request pair encloses its model output, not its tools.** The engine runs a tool as soon as its call is complete, while the Request is still open, so a call's `approval_decision` and the start of its output usually come before that Request's `request_end`, and the output may end after it. Every output of a Request's calls arrives before the next `request_begin` of the same origin. A retried attempt is a new pair: `request_end` with `status: "retryable"` and `retry_in_ms`, then `request_begin` again. `request_begin.thinking_level` is the thinking level the Request went out at.
5. **Usage closes each Request.** `token_usage` comes before its Request's `request_end`: `request` is that Request's count, `session` the Session's running total, both `{cache_read, cache_write, output, total}`.
6. **The stream is the Trace, plus fragments.** Every record the main Session writes to its Trace streams exactly once, when it is written, in Trace order. The exceptions:
   - two kinds of record are written to the Trace and never streamed: the `request_begin` / `request_end` pair of a compaction's own request, and `subagent` pointers;
   - a subagent's records carry `origin`, stream on the parent's stream only, and are kept in the child's own Trace;
   - when a new context opens, its `mcp_connect_begin` / `mcp_connect_end` pair and `tool_list_ready` stream as the context opens, and are written once its file opens.
7. **What falls between `compaction_begin` and `compaction_end` belongs to the compaction.** A text there is the summary, not an answer.

### session_meta on the stream

A main-Session `session_meta` streams once, when it is written. That happens at three moments:

- **A new Session's first message.** It heads the Session's first Trace file, before that Task's `task_begin`, so it is the first record of the run stream that creates a Session, and its `session_id` is how that stream names the new Session.
- **The context a compaction opens.** The new file opens just before the first record written after the compaction, and its `session_meta` streams then. When the compaction ended the previous Task, the next Task's `task_begin` has already gone by, since Task records never open a file: the `session_meta` comes after that `task_begin` and before the Task's input.
- **A model switch.** The switch opens the new file as it completes, between runs, so its `session_meta` is on the Session stream, not in the next run's stream.

No `session_meta` is sent again. A reader that needs the model later reads `GET …/sessions/:sessionId`; for the rest, it reads the whole history, which carries every file's `session_meta`. A subagent's `session_meta` streams with its `origin` when the child starts.

### Tasks

`task_begin` and `task_end` bracket a Task: one prompt's run, with the `hook` records of its stop hooks. A run can hold several Tasks: a stop hook that answers `continue` starts another in the same run, which is how goal mode runs its rounds. A manual compaction and a model switch are not Tasks; `compaction_begin` / `compaction_end` and the new file's `session_meta` frame them.

`task_begin` comes before everything the Task writes, its input included. An aborted Task still ends with `task_end`. A `task_begin` with no `task_end` before the next `task_begin` or the end of the run is a Task that never reached its end: the server failed while driving it.

## Control frames

| Frame | Data | When |
| --- | --- | --- |
| `event: ping` | `{}` | First on a run stream, right after any replay on a Session stream, then every 20 seconds. It replaces the earlier `: keep-alive` comment, which a browser never hands to a page |
| `data: [DONE]` | — | The run stream's last line, once the run is over |

## The run stream

`POST <Base URL>/agents/:projectId/:agentId/runs` runs the agent once and answers with the run's stream; the body is described in [The run request](/agent-api#the-run-request). The stream reads, in order:

1. `ping`;
2. on a new Session's first message, the Session's `session_meta`;
3. `task_begin`, then the run's input as the Session records it: one user `text` per text item, then one `image_url` per image;
4. the run's records;
5. `task_end`, after the last Task's stop-hook records;
6. `data: [DONE]`.

A plain answer on a new Session, with timestamps and long values elided:

```text
event: ping
data: {}

id: 7c41d0a2-1
data: {"timestamp":"…","type":"session_meta","payload":{"session_id":"session-2026-10-23-10-00-00-3f9a1c2e","provider":"deepseek","model_id":"deepseek-v4-pro","model_context_window":1000000,"system_prompt":"…","agent_state":"…","workspace":"…","source":"api"}}

id: 7c41d0a2-2
data: {"timestamp":"…","type":"event_msg","payload":{"type":"task_begin"}}

id: 7c41d0a2-4
data: {"timestamp":"…","type":"model_msg","payload":{"type":"text","role":"user","text":"Say hello"}}

id: 7c41d0a2-5
data: {"timestamp":"…","type":"event_msg","payload":{"type":"tool_list_ready","tools":[…]}}

id: 7c41d0a2-6
data: {"timestamp":"…","type":"event_msg","payload":{"type":"request_begin","thinking_level":"medium"}}

id: 7c41d0a2-7
data: {"timestamp":"…","type":"model_msg","payload":{"type":"partial_text","role":"assistant","event_type":"start","text":""}}

id: 7c41d0a2-8
data: {"timestamp":"…","type":"model_msg","payload":{"type":"partial_text","role":"assistant","event_type":"delta","text":"Hello!"}}

id: 7c41d0a2-9
data: {"timestamp":"…","type":"model_msg","payload":{"type":"partial_text","role":"assistant","event_type":"stop","text":""}}

id: 7c41d0a2-10
data: {"timestamp":"…","type":"model_msg","payload":{"type":"text","role":"assistant","text":"Hello!"}}

id: 7c41d0a2-11
data: {"timestamp":"…","type":"event_msg","payload":{"type":"token_usage","session":{"cache_read":0,"cache_write":0,"output":2,"total":412},"request":{"cache_read":0,"cache_write":0,"output":2,"total":412}}}

id: 7c41d0a2-12
data: {"timestamp":"…","type":"event_msg","payload":{"type":"request_end","status":"completed"}}

id: 7c41d0a2-14
data: {"timestamp":"…","type":"event_msg","payload":{"type":"task_end"}}

data: [DONE]
```

- No frame names the Session. A new Session is named by its `session_meta`, the stream's first record; a run that continues a Session is on the `session_id` its request sent.
- The server subscribes to the Session before it starts the Task, so nothing of the run is missed. A refusal, such as a busy conversation or a malformed body, is answered in JSON before any stream starts.
- The stream starts at the run's first main-Session record: what the Session published before it, such as a background subagent's output, is not on this stream.
- `[DONE]` is written when the Session goes back to idle. A body that ends without it means the connection broke, and the run's outcome is unknown: `GET …/sessions/:sessionId` gives its status, and the history its records.
- A run the server could not finish leaves its last `task_begin` unclosed before `[DONE]`.
- Disconnecting aborts the run and denies its pending approvals. `POST …/sessions/:sessionId/abort` aborts it and keeps the stream: the records end with `abort` and `task_end`, and the stream with `[DONE]`.

## The Session stream

| Door | Path | Credential |
| --- | --- | --- |
| Key | `GET /api/amsp/v1/sessions/:sessionId/stream` | The agent's key, or none when it allows keyless access. Only that agent's API conversations |
| Cookie | `GET /api/sessions/:sessionId/amsp` | A sign-in cookie or the local API token, with the same Project access as the Web App |

Both doors serve one handler. A Session stream follows the Session across runs, including the ones it did not start: a run started with `POST …/sessions/:sessionId/tasks`, one started from the Web App, or another caller's. It carries the records and `ping` and nothing else: no `[DONE]`, no snapshot on subscribe. It stays open until the caller closes it.

- **Resuming.** Send the last record id you saw as `Last-Event-ID`, or as the `lastEventId` query parameter where a header cannot be set; the header wins when both are present. The server keeps a bounded buffer per active Session: when the id is still in it, the records after it are replayed first. When it is not, because the buffer has moved past it or the server restarted since, no stream opens: the request is answered `409` `resync_required` in the usual error envelope. Start over as on a first open: read the history and subscribe without an id.
- **Joining.** Subscribe first, then read the history, so nothing falls in between: hold what arrives meanwhile, deliver it after the history, and skip the records the history already holds. The history's `live` field joins the two; see [History](#history). The client's `SessionReader` does all of this.
- **Dead connections.** A stream that has carried a `ping` and then stays silent for 50 seconds is dead: close it and reopen it with `Last-Event-ID`.
- The Web App's own `GET /api/sessions/:sessionId/stream` is a different channel: it carries the same records plus the Web App's server events; see [Streaming (SSE)](/server-api#streaming-sse).

### History

`GET …/sessions/:sessionId/messages`, at `/api/amsp/v1/sessions/:sessionId/messages` or `/api/sessions/:sessionId/messages`, reads what the Trace holds, each subagent's records expanded in place:

- with no parameter, the whole history, each Trace file's `session_meta` included;
- with `tailLimit=n`, the newest n Tasks;
- with `before=<cursor>&limit=n`, the n Tasks before a cursor, `<file>:<ordinal>` from the previous page's `page.before`. `limit` defaults to 200, and n is between 1 and 1000.

A window never splits a Task and stays within 4 MiB, holding at least one Task. Records outside any Task, such as a manual compaction or a model switch, go with the Task before them.

The answer is the Web App's own history read, shared by both doors, so its own fields are camelCase while each record stays snake_case:

```ts
interface MessagesResponse {
  messages: (AmspRecord & { tracePosition?: { fileIndex: number; ordinal: number } })[];
  live?: { cursor: string; fragments: AmspRecord[] };
  page?: {
    before?: string; // pass back as `before`; absent at the beginning
    earlierTurns: number;
    prior: Record<string, number>;
    contextModel?: { provider: string; modelId: string };
    agentState?: string;
  };
}
```

- `page` comes with a windowed read, whose images are served by reference: a PNG, JPEG, GIF or WebP `data:` URL in a main-Session record is replaced with that door's `…/sessions/:sessionId/trace-image?file=&ordinal=[&i=]`, which answers the image.
- `live` comes while the Session runs, except on a `before` page. `cursor` is the stream's last id when the history was read, and `fragments` holds each open streamed message so far as one `partial_*` `start` carrying all that has streamed. Drop the held `partial_*` records at or before the cursor (same epoch), deliver `fragments` in their place, then the rest. The cursor never drops a complete record: deduplicate those against the history. When the cursor's epoch differs from the stream's, skip `live` and let the start-over after `resync_required` cover it.

## Approvals

When an API conversation's [approval mode](/agent-api#approval-mode) asks about a call, the call waits. The waiting calls are a resource, not a frame on the stream:

```text
GET  …/sessions/:sessionId/approvals[?wait=<seconds>]
     → 200 {"approvals": [{"tool_call": <the tool_call record's payload>, "origin"?: [...]}]}
POST …/sessions/:sessionId/approvals/:toolCallId   {"decision": "allow" | "deny"}
     → 204, or 404 approval_not_found when it was already decided or never waited
```

- Without `wait`, the list is answered at once. With it, an empty list is held until a call waits, answered empty when the seconds run out, and closed if the caller goes away. `wait` is clamped to 1–60; anything but a whole number is `400`.
- A subagent's call is listed with its `origin` and answered through the main Session's id.
- Every call the engine runs gets an `approval_decision` record, the automatic ones included: `allow`, `deny`, or `forbidden` when the command policy vetoed the call. A program that sees a completed `tool_call` with no decision yet can poll the resource until every call has one.
- Once the conversation is unarchived, the Web App can answer the same call; the first answer decides. The server sets no timeout.
- The cookie door lists the same calls at `GET /api/sessions/:sessionId/approvals`, and answers them at `POST /api/sessions/:sessionId/approvals/:toolCallId`.

## A run's result

`[DONE]` says only that a run is over; how it went is in the records. The client's `RunResult` reads it from the main Session's records, those without `origin`, in this order:

1. The last `task_begin` has no `task_end`, or no Task began: `fatal`, with error code `internal`. The server failed while driving the run.
2. An `abort` record: `aborted`, with its error. The turn limit ends a Task this way too, with error code `max_turns`.
3. The last `request_end` or `compaction_end` that is not `completed` and carries no `retry_in_ms`, unless a later `request_begin` followed: its status and error. A response the retries never got past its output cap ends `retryable`, with error code `output_truncated`.
4. Otherwise `completed`.

The rest of the result:

- `text`: the assistant texts of the main Session's Requests that completed, joined with a blank line, leaving out what falls between `compaction_begin` and `compaction_end` (a Request that was retried or interrupted contributes none, though its texts have their records);
- `usage`: the sum of every `token_usage.request`, subagents included;
- `sessionUsage`: the main Session's last `token_usage.session`, or `null`;
- `requests`: the number of main-Session `request_begin` records, retried attempts included.

A program that reads the stream itself gets the same result by feeding the records to the client's `RunCollector`, with the `session_id` it sent when the run continued a Session.

## Errors

Before a stream starts, a refusal is an HTTP status and `{"error": {"code", "message"}}`; the statuses are listed under [Errors](/agent-api#errors). A run that ends `fatal` or `retryable` is still answered `200`: the HTTP status covers only the request.

Inside the stream, a failure is a record's `error_code` and `error_message`: on `request_end` and `compaction_end`, on `abort`, and on `mcp_connect_end` and each of its `results`. The codes:

| `error_code` | Meaning |
| --- | --- |
| `user_abort` | The run was aborted: by `POST …/abort`, the run stream's caller disconnecting, or someone in the Web App |
| `backoff_interrupted`, `compaction_interrupted` | An abort arrived while the engine waited to retry, or during a compaction |
| `max_turns` | The Task reached its turn limit; `error_message` names the limit |
| `timeout` | The model's connection went silent |
| `network` | A dropped connection, a provider error with no more specific code, or a failure that fits nowhere else |
| `rate_limited` | The provider answered `429`: its rate limit, or an exhausted quota |
| `malformed` | The model's response failed to parse or was cut short |
| `output_truncated` | The model's response stopped at its output limit: not committed, and retried |
| `auth` | The provider refused the credentials |
| `rejected` | The provider refused the request for good (parameters, quota) |
| `image_rejected` | The provider rejected (4xx) a request whose input holds images; the engine takes any such rejection as the images' and reads nothing out of the wording. The images are replaced with a fixed note and the request retried at once, the provider's error quoted in the retry's `[request_error]` line (`retryable` with `retry_in_ms: 0`) |
| `unsupported` | The request asked for something the model cannot do |
| `invalid_input` | The input could not be assembled into a request |
| `connect_failed` | An MCP server failed to connect |
| `mcp_needs_setup`, `mcp_sign_in_required` | An MCP server was not contacted: its entry references a key the agent's vault lacks, or the server needs an OAuth sign-in |

`internal` is no record's code: it is the one `RunResult` gives a run whose last Task never closed.

## Examples

Timestamps, ids and blank lines are left out below, and `…` stands for the fields a line does not need.

A tool call that waits for the caller's approval, then a second Request. The tool runs while the first Request is still open:

```text
data: {"type":"event_msg","payload":{"type":"request_begin","thinking_level":"medium"}}
data: {"type":"model_msg","payload":{"type":"partial_tool_call","event_type":"start","name":"exec_command","tool_call_id":"call_1",…}}
data: {"type":"model_msg","payload":{"type":"partial_tool_call","event_type":"delta","arguments":"{\"command\": \"ls\"}","tool_call_id":"call_1",…}}
data: {"type":"model_msg","payload":{"type":"partial_tool_call","event_type":"stop","tool_call_id":"call_1",…}}
data: {"type":"model_msg","payload":{"type":"tool_call","role":"assistant","name":"exec_command","arguments":"{\"command\":\"ls\"}","tool_call_id":"call_1"}}
            ← caller: GET …/sessions/<id>/approvals?wait=30 → {"approvals":[{"tool_call":{…,"tool_call_id":"call_1"}}]}
            ← caller: POST …/sessions/<id>/approvals/call_1 {"decision":"allow"} → 204
data: {"type":"event_msg","payload":{"type":"approval_decision","decision":"allow","tool_call_id":"call_1"}}
data: {"type":"model_msg","payload":{"type":"partial_tool_call_output","event_type":"start","output":"","tool_call_id":"call_1",…}}
data: {"type":"event_msg","payload":{"type":"token_usage",…}}
data: {"type":"event_msg","payload":{"type":"request_end","status":"completed"}}
data: {"type":"model_msg","payload":{"type":"partial_tool_call_output","event_type":"delta","output":"README.md\nsrc\n","tool_call_id":"call_1",…}}
data: {"type":"model_msg","payload":{"type":"partial_tool_call_output","event_type":"stop","tool_call_id":"call_1",…}}
data: {"type":"model_msg","payload":{"type":"tool_call_output","role":"user","output":"README.md\nsrc\n","tool_call_id":"call_1","status":"completed"}}
data: {"type":"event_msg","payload":{"type":"request_begin","thinking_level":"medium"}}
…
```

A transient failure and its retry, then the caller aborts:

```text
data: {"type":"event_msg","payload":{"type":"request_begin",…}}
data: {"type":"event_msg","payload":{"type":"request_end","status":"retryable","error_code":"network","error_message":"fetch failed","attempt":1,"retry_in_ms":1000}}
event: ping
data: {}
data: {"type":"event_msg","payload":{"type":"request_begin",…}}
data: {"type":"model_msg","payload":{"type":"partial_text","event_type":"delta","text":"Let me",…}}
            ← caller: POST …/sessions/<id>/abort → 202
data: {"type":"model_msg","payload":{"type":"partial_text","event_type":"stop",…}}
data: {"type":"model_msg","payload":{"type":"text","role":"assistant","text":"Let me"}}
data: {"type":"event_msg","payload":{"type":"request_end","status":"aborted","attempt":2}}
data: {"type":"event_msg","payload":{"type":"abort","error_code":"user_abort"}}
data: {"type":"event_msg","payload":{"type":"task_end"}}
data: [DONE]
```

## From the earlier v1 events

Up to PenguinHarness 0.2.16, `/api/amsp/v1` served a translation of these records as `<subject>.<phase>` events, each a bare `data:` line with `type` and `at`. The path stayed and the events were replaced, so a program that parses them, or uses the `@prismshadow/amsp` client of 0.2.16 or earlier, needs the table below. The client of later versions cannot read an older server's events either.

| Earlier event | Now |
| --- | --- |
| `run.started` | No frame: a new Session is named by its `session_meta`, a continued one by the `session_id` the request sent, and the agent is the one the request named |
| `run.done` | `data: [DONE]`; the status and counts are read from the records, by the same rules ([A run's result](#a-runs-result)) |
| `context.opened` | `session_meta` |
| `mcp_connect.started` / `mcp_connect.done` | `mcp_connect_begin` / `mcp_connect_end` |
| `tools.ready` | `tool_list_ready` |
| `request.started` / `request.done` | `request_begin`, with `thinking_level` / `request_end`, whose usage is the `token_usage` before it |
| `text.delta`, `thinking.delta`, `tool_call.delta`, `tool_result.delta` | `partial_text`, `partial_thinking`, `partial_tool_call`, `partial_tool_call_output`, with `event_type` `start`, `delta` or `stop` |
| `text.done`, `thinking.done`, `tool_call.done`, `tool_result.done`, `inline_data.done`, `inline_thinking.done`, `image_url.done` | The complete `text`, `thinking`, `tool_call`, `tool_call_output`, `inline_data`, `inline_thinking`, `image_url`, with `fidelity` and `sender` |
| `summary.delta` / `summary.done` | `partial_text` / `text` between `compaction_begin` and `compaction_end` |
| `approval.requested` | The approvals resource, `GET …/sessions/:sessionId/approvals` |
| `approval.decided` | `approval_decision` |
| `compaction.started` / `compaction.done` | `compaction_begin` / `compaction_end` |
| `hook.fired` | `hook` |
| `run.done` with `status: "fatal"` and code `internal` | A `task_begin` left unclosed before `[DONE]` |
| `: keep-alive` | `event: ping` |
| `at` | The envelope's `timestamp` |

New on the wire: `task_begin` / `task_end`, `abort`, `token_usage`, each fragment's `stop`, and the run's own input. A compaction request's `request_begin` / `request_end` and the `subagent` pointers stay in the Trace only.

## Versioning

- The version is in the path, `/api/amsp/v1`; records carry none.
- Within `/v1`, changes only add: new records, new optional fields, new control frames. A reader that ignores what it does not know keeps working.
- A change to what an existing field means needs a new version.
- Since the records are the Trace's own, a change to a record is a change to AMSP, held to the same rules.

## Reading the stream yourself

A run is a POST that carries `Authorization`, so read it with `fetch`, not `EventSource`. A page on the server's own origin can open the cookie door's Session stream with `EventSource`, passing `lastEventId` in the URL when it reopens one itself. Read the body the way an `EventSource` would: lines end in LF, CRLF or a lone CR; a blank line ends an event; lines starting with `:` are comments; the `data:` lines of one event join with a newline. Then dispatch on the event name, and stop a run stream at `data: [DONE]`.

`@prismshadow/amsp` exports each step: `readSse` yields a body's events as `{event, id, data}`, `frameOf` sorts one event into a record, a control frame, `[DONE]` or a name AMSP does not define, `readAmsp` does both, and `RunCollector` folds a run's records into its result. See [Client reference](/agent-api#client-reference).
