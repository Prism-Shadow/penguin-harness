# PRFC-0018 AMSP and Agent API

[中文版](PRFC-0018-amsp.zh.md)

> **Source**: `rfcs/PRFC-0018-amsp.md` from the design repository [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design) — landed (default branch `main`, commit [`ac673a24`](https://github.com/Prism-Shadow/penguin-harness-design/commit/ac673a245eec78d6afca35e260dce28b2a3ab3ac)).
> **Rev**: v1.1.0 (v1.0.0 migrated into the main repository); the conventions for this document are in [README.md](README.md), with per-version changes recorded in `## Changes` at the end.

- Feature Name: `amsp`
- Start Date: 2026-10-07
- PRFC PR: Prism-Shadow/penguin-harness-design#266
- Implementation PR: Prism-Shadow/penguin-harness#1000 (stacked on top of the session-source changes)
- Related: PRFC-0001 "Module" (a route group is a contribution); the streaming protocol of MMSP (agenthub)

## Summary
[summary]: #summary

AMSP (Agent Message Stream Protocol) is MMSP's counterpart at the Agent layer: MMSP streams one model call, AMSP streams one Agent run (one Task, TAX-006). It is the server's projection of a Session's existing real-time stream (OmniMessage and the `task_state` / `approval_request` server events), delivered over SSE as `data:` lines and closed with `data: [DONE]`; OmniMessage gains no fields for it. The companion Agent API lets a Project owner, on the "API" tab of the Agent settings page, enable external access for an individual Agent, set the approval mode for API sessions, and issue keys; external programs start a session with a Base URL, a key (optional), and an Agent ID, and carry the context forward with `session_id`. The JS SDK `@prismshadow/amsp` is its client, and AMSP's types are exported by it as well — the server imports it for types only.

## Motivation
[motivation]: #motivation

The need is to let external programs converse with a particular Agent: start a session with a URL, an optional key, and an Agent ID, and carry the context forward with a Session id; enable it per Agent, with enabled Agents marked in the list; and pair it with a JS SDK for connecting.

Neither of the existing paths fits:

- **The Web App's own API** (`/api/sessions/*`). The credentials it recognizes are the login Cookie or the local API token, and the latter authenticates as the built-in admin (05 "CLI › Authentication: local API token") — handing that to an external program is handing over the whole server. Its stream is also an internal protocol: the start / stop of `partial_*`, `resync_required`, the repeated publication of `task_state`, and the set of server-event kinds all evolve with the implementation; once it becomes an external contract, every internal adjustment is a breaking change.
- **Messaging** (05 "Messaging"). It binds a chat-software conversation to an existing Session and sends back human-readable completion text. What a program wants is an entrance issued per Agent, a Session of its own for each caller, and the structured process — tool calls, approvals, usage.

Concrete scenarios:

- A script in CI hands a diff to a review Agent and reads back the conclusion and the usage; the next call carries `session_id` and follows up on the same stretch of context.
- A backend treats some Agent as a service and streams its answers through; when a tool call needs confirmation, that backend's own UI asks the user and hands the decision back.
- A local web page or desktop tool calls an Agent on the local PenguinHarness directly, without logging into the Web App.

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

**For the Project owner.** Open the "API" tab of the Agent settings page, turn on "Enable API access", and below it pick the approval mode for API sessions (default `allow-all`). The "Connection" section gives the Base URL (`<site address>/api/amsp/v1`) and the Agent ID (`<project_id>/<agent_id>`), each with a copy button; "New key" takes a name, and the key is shown only that once. If you use it only locally, you can turn on "Allow keyless access" — any program that can reach the address can then talk to that Agent. Once enabled, the title row of this Agent in the Agents list carries an API icon; sessions opened via the API appear in the sidebar under that Agent's "Background sessions" subfolder, where a person can open, read, approve, and keep typing. The "Try it" at the end of the tab runs a sample ("What time is it?") as the logged-in user; what you see is the complete event stream a program will receive, and running it again resumes with the `session_id`.

**For the caller.** One request is one run:

```bash
curl -N http://localhost:7364/api/amsp/v1/agents/demo/coder/runs \
  -H "Authorization: Bearer $PENGUIN_AGENT_KEY" -H "Content-Type: application/json" \
  -d '{"input":"Say hello"}'
```

```text
data: {"type":"run.started","at":"2026-10-07T10:00:00.000Z","session_id":"session-2026-10-07-10-00-00-3f9a1c2e","agent":"demo/coder"}
data: {"type":"request.started","at":"…","request":1}
data: {"type":"text.delta","at":"…","role":"assistant","text":"Hello"}
data: {"type":"text.delta","at":"…","role":"assistant","text":"!"}
data: {"type":"text.done","at":"…","role":"assistant","text":"Hello!","stop_reason":"completed"}
data: {"type":"request.done","at":"…","request":1,"status":"completed","usage":{"cache_read":0,"cache_write":0,"output":2,"total":412}}
data: {"type":"run.done","at":"…","status":"completed","requests":1,"usage":{"cache_read":0,"cache_write":0,"output":2,"total":412},"session_usage":{"cache_read":0,"cache_write":0,"output":2,"total":412}}
data: [DONE]
```

- The first event, `run.started`, gives the `session_id`; carrying it in the next request body (`{"session_id": "…", "input": "…"}`) continues the same context.
- The stream always closes with `run.done`, whose `status` is one of `completed` / `aborted` / `retryable` / `fatal`, and the usage of the whole run is summed up there. A stream that ends without `run.done` means the connection dropped.
- Each item comes as zero or more `.delta` fragments followed by one `.done` carrying the complete content (the streamed compaction summary is the exception — it has fragments only); a caller who cares only about the result can read just the `.done`s. A tool begins executing as soon as its call is complete, so its approval and result may appear before that Request's `request.done`.
- When the approval mode requires asking, `approval.requested` appears in the stream, and the caller answers `allow` or `deny` with `POST …/sessions/<id>/approvals/<tool_call_id>`. Disconnecting aborts the run.

JavaScript programs use the SDK:

```ts
import { AgentClient } from "@prismshadow/amsp";

const client = new AgentClient({ baseUrl: "http://localhost:7364/api/amsp/v1", agent: "demo/coder", apiKey: process.env.PENGUIN_AGENT_KEY });

const run = client.stream({ input: "Summarize README.md" });
for await (const event of run) {
  if (event.type === "text.delta") process.stdout.write(event.text);
}
const first = await run.result();

const second = await client.run({ sessionId: first.sessionId, input: "Now list its headings", onApproval: () => "allow" });
console.log(second.text, second.usage.total);
```

Without `onApproval`, the SDK answers `deny` to every approval request.

**For maintainers.** AMSP is a translation layer, not a second execution path: runs are still driven by `SessionManager` as always; the translator subscribes to the same Session channel and maps each event it receives into AMSP events. The internal stream can keep evolving as long as the mapping table keeps up; the external contract changes only by the rules of `/v1`.

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### AMSP

#### Relationship with MMSP

Inherited from MMSP: SSE `data:` lines closed with `data: [DONE]`; a `: keep-alive` comment when there is nothing to report; bytes always carried as base64 text; one error envelope plus a fixed HTTP status table; a wrong or missing key is rejected before the request body is read; openness (keyless) must be stated explicitly — MMSP states it at startup, here it is stated on the Agent's API tab; usage is read at the end (`run.done`), with each Request's usage in `request.done` besides.

Not inherited: the `event_type` / `content_items` nesting — AMSP events are flat objects distinguished by `type`; `fidelity` (a vendor-internal fidelity field; Trace keeps it); `session_meta.source` (a Session run via the API is `api` by nature). MMSP's items are `K.delta+ K.done`; AMSP relaxes this to `K.delta* K.done`: an internal complete message may have no fragment form (e.g. `inline_data`), or may arrive directly without fragments.

#### Transport

- `POST /api/amsp/v1/agents/:projectId/:agentId/runs`, `Content-Type: application/json`, optional `Authorization: Bearer <key>`. Success yields `200`, `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`; one `data: <JSON>` block per event, with no `event:` / `id:` (v1 does not support resumption), ending with `data: [DONE]`.
- After 15 seconds of silence, write one `: keep-alive` line (MMSP's value).
- Every event carries `type` and `at` (ISO 8601 UTC); sub-session events also carry `origin`, the same as OmniMessage's `origin` — the chain of Sessions from the outside in; absent means the main session.
- Errors before the stream starts: an HTTP status code plus `{"error": {"code": "<snake_case>", "message": "<text>"}}` — the server's existing error envelope. Errors after the stream starts are not framed separately: the terminating event `run.done` carries the `status` and the `error`, followed by `[DONE]`.
- Byte fields (`inline_data.done.data`, `inline_thinking.done.data`, the `images[]` of a tool result, data URLs in the input) are base64 text in both directions.
- Routing is case-sensitive; an unknown path under the prefix gets a JSON `404 not_found` — it does not fall into the SPA, and it is not a 401.

#### Grammar

```text
stream       := run.started body* run.done                 ; exactly one terminating event, always emitted
body         := context.opened | mcp_connect.started | mcp_connect.done | tools.ready
              | request | tool_result | approval | compaction | hook.fired
              | text.done(role user) | image_url.done
request      := request.started (item | tool_result | approval | hook.fired)* request.done
item         := K.delta* K.done                            ; K = thinking | text | tool_call | inline_data | inline_thinking
tool_result  := tool_result.delta | tool_result.done       ; each is a single event: one result is tool_result.delta* tool_result.done,
                                                           ; attributed by tool_call_id, and may cross request.done
approval     := approval.requested | approval.decided
compaction   := compaction.started (summary.delta* | summary.done)? compaction.done
```

Rules:

1. **Exactly one terminating event.** `run.done` is the last event before `[DONE]`: normal completion, an abort, a fatal or retry-exhausted failure, and a server-internal fault (`status: "fatal"`, `error.code: "internal"`) all end this way. A stream that ends without it means the connection dropped, and the SDK throws `AmspStreamError`.
2. **Items close with `.done`; fragments and `.done` are never reconciled.** `.done` carries the complete content; the server forwards fragments and complete items exactly as the engine produced them, never rebuilding one from the other. For `text` and `thinking`, the fragments concatenated equal the `.done`; for `tool_call`, not necessarily: the fragments are the vendor's raw text, while `tool_call.done.arguments` is the engine's re-serialization of the parsed arguments (fragments `{"command": "ls"}`, complete `{"command":"ls"}`) — both parse to the same object. There may be no fragments before a `.done`; the streamed compaction summary is the only item without a `.done` (rule 7).
3. **Model output within one origin appears in order; tool results are not items.** Within one origin, `thinking` / `text` / `tool_call` / `inline_*` items appear sequentially: one item's `.done` precedes the next item's first fragment. `tool_result.*`, `approval.*`, and `hook.fired` may fall between any two events of an item; the results of parallel tools interleave, attributed by `tool_call_id`; different origins interleave freely, attributed by `origin`.
4. **A pair of Request events brackets its model output, not its tool execution.** The engine starts executing a tool as soon as the call is complete, while the Request is still open: `approval.*` arrives before that Request's `request.done`; the result starts as soon as the call is approved — usually also before `request.done` — and may finish after it. All results of one Request arrive before the next `request.started` of the same origin. A retry is a new pair: the `request.done` has `status` `retryable` with `retry_in_ms`, followed by another `request.started`.
5. **Usage.** `request.done.usage` is the count of that attempt (null when absent); `compaction.done.usage` is the sum of the compaction's attempts; `run.done.usage` is the sum of all `request.done.usage` and `compaction.done.usage` of this run; `run.done.session_usage` is the session cumulative last reported by the engine (null when absent).
6. **Unknown `type`s must be ignored.** Within `/v1` everything is additive — new event types, new optional fields; changing the meaning of an existing field is `/v2`.
7. **Compaction.** Between `compaction.started` and `compaction.done` there are only `summary.*`: the compaction request's thinking is not forwarded, and `text.*` never appears. The engine either streams a summary as fragments only or gives the complete text only — never both: a streamed summary is `summary.delta*` straight into `compaction.done`, with no `summary.done`; a summary given as a whole is a single `summary.done`. There is no `context.opened` after compaction: the new context opened by compaction is written by the engine into Trace, not into the stream. In practice `context.opened` appears only when a sub-session starts (with `origin`); the main session streams it only on a model switch, and switches happen between two runs.

#### Events

Fields follow the types exported by `@prismshadow/amsp`; on the wire everything is snake_case. The shared vocabulary is the same words and the same meanings as OmniMessage: `StopReason` is `completed` | `aborted` | `retryable` | `fatal`; usage `TokenCounts` is `{ cache_read, cache_write, output, total }`; the error `AmspError` is `{ code, message }`, with `code` stable and snake_case.

| Event | Fields (besides `type` and `at`) | Meaning |
| --- | --- | --- |
| `run.started` | `session_id`, `agent` (`<projectId>/<agentId>`) | The first event; a newly created Session is given its id here |
| `run.done` | `status`, `error?`, `requests`, `usage`, `session_usage` | The only terminating event; `requests` is the number of Requests issued in this run (retries included) |
| `context.opened` | `session_id`, `provider`, `model_id`, `context_window` | A new context streamed out by the engine: with `origin`, a sub-session is starting; the main session streams it only on a model switch (which happens between two runs); the context opened by compaction does not enter the stream |
| `mcp_connect.started` / `.done` | `servers` / `status`, `results`, `error?` | The connection of MCP servers |
| `tools.ready` | `tools` (`name`, `description`, `parameters?`) | The tool list of this context |
| `request.started` / `.done` | `request` (counting from 1 within the run) / plus `status`, `usage`, `error?`, `attempt?`, `retry_in_ms?` | One Request attempt (TAX-005); `retry_in_ms` appears only when the engine will retry within this run |
| `text.delta` / `.done` | `role`, `text` / plus `stop_reason`, `sender?` | Text; a `.done` with `role: "user"` is user text injected mid-run (steering, hook continuations, harness prompts) |
| `thinking.delta` / `.done` | `thinking` / plus `stop_reason` | Thinking |
| `tool_call.delta` / `.done` | `tool_call_id`, `name` (present on the first fragment, may be empty afterwards), `arguments` (fragments are the vendor's raw streamed text / complete is the engine's re-serialization of the parsed arguments) / plus `stop_reason` | A tool call |
| `tool_result.delta` / `.done` | `tool_call_id`, `output`, `images?` / plus `stop_reason` | A tool result; may start before `request.done` and finish after it; `images` are not fragmented — one fragment carries the full set |
| `inline_data.done` / `inline_thinking.done` | `role` (the former only), `mime_type`, `data` (base64), `stop_reason` | Inline binary output, with no fragment form |
| `image_url.done` | `role: "user"`, `image_url` | A user image injected mid-run |
| `approval.requested` / `.decided` | `tool_call` (`tool_call_id`, `name`, `arguments`) / `tool_call_id`, `decision` (`allow` / `deny` / `forbidden`) | Approvals |
| `compaction.started` / `.done` | `reason`, `mode`, `context`, `turns` / `reason`, `mode`, `status`, `usage`, `error?`, `attempt?` | Compaction |
| `summary.delta` / `.done` | `text` / plus `stop_reason` | The compaction summary, appearing only inside compaction; when streamed, fragments only with no `.done`; when given as a whole, a single `.done` |
| `hook.fired` | `hook`, `name`, `decision?`, `reason?`, `output?` | Hooks |

Request and response bodies: the run body is `{ session_id?, input }`, where `input` is a string, or an array of `{ type: "text", text }` and `{ type: "image_url", image_url }` (a data URL or an http(s) address); the two `GET` routes return `{ agent: { id, name?, description? } }` and `{ session: { id, agent, status, provider, model_id, created_at, last_active_at } }` respectively; the approval body is `{ decision: "allow" | "deny" }`.

#### Mapping

The translator `AmspTranslator` (`packages/server/src/amsp/translate.ts`) is a pure class: `feed(evt)` maps one event that `SessionManager.drive` posts onto the Session channel (an OmniMessage envelope, or a `server_event`) to zero or more AMSP events. It holds only: the submitted input (used to drop its echo) and whether it has appeared yet; per-origin Request counters / usage awaiting stamping / usage accumulated inside compaction; the run's totals; the most recent `session_usage`; the abort record; the termination record; and the `stop_reason` of the main session's last assistant text.

| Internal (OmniMessage `payload.type` or a server event) | AMSP | Notes |
| --- | --- | --- |
| Everything on the channel before the input's echo (idle `task_state` re-sent on sub-session state changes, output of background sub-sessions) | (dropped) | The translator starts at this run's input echo; the handler that follows the rebuilt session's new id starts immediately |
| This run's own input message | (dropped) | Compared verbatim against the submitted envelope |
| `session_meta` | `context.opened` | With `origin`, a sub-session is starting; without it, streamed only on a model switch (between two runs). The first context and the context opened by compaction are written to Trace only, not into the stream |
| `mcp_connect_begin` / `mcp_connect_end` | `mcp_connect.started` / `.done` | The error code and error message combined into `error` |
| `tool_list_ready` | `tools.ready` | |
| `request_begin` | `request.started` | The counter increments on the main session's `request_begin`; sub-sessions count separately |
| `token_usage` | (stashed) | It arrives before `request_end`: stamped onto the next `request.done` (inside compaction, the `compaction.done`) and counted into the totals; its session cumulative is `session_usage` |
| `request_end` | `request.done` | One that is not `completed` and carries no `retry_in_ms` is recorded as this run's terminating error |
| start and delta of `partial_text` / `partial_thinking` / `partial_tool_call` / `partial_tool_call_output` | `text.delta` / `thinking.delta` / `tool_call.delta` / `tool_result.delta` | stop produces no event; `partial_text` inside compaction is a `summary.delta` with no `summary.done` after it, and `partial_thinking` inside compaction is dropped |
| `text` (assistant) / `thinking` / `tool_call` / `tool_call_output` | `text.done` / `thinking.done` / `tool_call.done` / `tool_result.done` | Assistant `text` inside compaction is a `summary.done` (the engine has it only when it emits the summary as a whole), and `thinking` inside compaction is dropped; `arguments` stays a string, fragment and complete each verbatim, neither rebuilt nor compared; a tool executes as soon as its call is complete, and its result may arrive before this Request's `request_end` |
| User `text` / `image_url` mid-run | `text.done` (`role: "user"`, with `sender`) / `image_url.done` | |
| `inline_data` / `inline_thinking` | `inline_data.done` / `inline_thinking.done` | |
| Server events `approval_request` / `approval_decision` | `approval.requested` / `approval.decided` | `origin` copied as-is; may occur while a Request is still open — the engine waits for the decision before resuming the model stream |
| `compaction_begin` / `compaction_end` | `compaction.started` / `.done` | Sets / clears "inside compaction"; `fatal`, or `retryable` not followed by a new `request_begin`, is recorded as a terminating-error candidate |
| `hook` | `hook.fired` | |
| `abort` | (recorded) | Its error code goes into `run.done.error`, status `aborted` |
| Server event `task_state` back to `idle` | `run.done` | `running` re-published during the run is ignored |
| All other server events (`session_title`, `goal_*`, `resync_required`, etc.) | (dropped) | Not part of one run's record |

`run.done.status` is decided in order: an `abort` was seen → `aborted`; a terminating `request_end` / `compaction_end` was recorded → take its status and error; the main session's last assistant `text.done` has `stop_reason` `fatal` with no error recorded (the engine's max-turns prompt) → `fatal`, without `error`; otherwise `completed`.

This table honors a few existing rules: OmniMessage gains no fields for AMSP; the start / stop of `partial_*` remains internal discipline; a `.done` is never rebuilt from fragments — fragments and complete items are each forwarded verbatim and never reconciled; the model is read from the `session_meta` where it already lives.

#### Errors

Before the stream starts (HTTP):

| Status | `code` | When |
| --- | --- | --- |
| 400 | `bad_request` | The request body is not a JSON object; `input` is missing or empty; an unknown item type or a file item; `session_id` is not a valid id; an image data URL exceeds the inline limit or has an unsupported MIME type; `decision` is not allow / deny |
| 401 | `unauthorized` | The Agent requires a key, and the request carries none, a wrong one, or a deleted one; decided before the request body is read |
| 403 | `agent_api_disabled` | The administrator master switch is off |
| 404 | `agent_not_found` | No such Agent, its API switch is off, or the key belongs to a different Agent — all three get the same answer |
| 404 | `session_not_found` | Unknown id, not an API session, or belonging to a different Agent |
| 404 | `approval_not_found` | An already-decided or unknown `tool_call_id` |
| 404 | `not_found` | An unknown route under the prefix |
| 409 | `task_in_progress` / `compacting` | The Session is busy |
| 413 / 415 | `payload_too_large` / `unsupported_media_type` | The existing `/api/*` request-body limit and the JSON-only guard |
| 429 | `too_many_runs` | The Agent already has 4 running Sessions; carries `Retry-After` |
| 503 | (as-is) | The server is shutting down, or the Agent or Session is being deleted |

In-stream (`run.done.error.code`): OmniMessage `ErrorCode`s exactly as recorded, plus AMSP's own `internal` (a server fault while driving) and `session_rebuilt` (see "One run").

#### Naming and versioning

The protocol is named AMSP; the wire version appears only in the path (`/api/amsp/v1`), and events carry no version field. Event names are `<subject>.<phase>`, and items are `K.delta` / `K.done`, as in MMSP. One run is one Task, and the route name takes the industry-common runs.

#### Examples

A tool call approved by the caller, followed by a second Request. The tool executes while the first Request is still open: the approval and the start of the result precede its `request.done`, and the rest of the result comes after it; the arguments in the fragments are the vendor's raw text, while those in `.done` are the engine's re-serialization of the parsed arguments:

```text
data: {"type":"run.started",…}
data: {"type":"request.started","request":1,…}
data: {"type":"tool_call.delta","tool_call_id":"call_1","name":"exec_command","arguments":"",…}
data: {"type":"tool_call.delta","tool_call_id":"call_1","name":"","arguments":"{\"command\": \"ls\"}",…}
data: {"type":"tool_call.done","tool_call_id":"call_1","name":"exec_command","arguments":"{\"command\":\"ls\"}","stop_reason":"completed",…}
data: {"type":"approval.requested","tool_call":{"tool_call_id":"call_1","name":"exec_command","arguments":"{\"command\": \"ls\"}"},…}
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

One compaction between two Requests, with the summary streamed (hence no `summary.done`), and no `context.opened` after it:

```text
data: {"type":"request.done","request":1,"status":"completed","usage":{…},…}
data: {"type":"compaction.started","reason":"context","mode":"summarize","context":300,"turns":1,…}
data: {"type":"summary.delta","text":"",…}
data: {"type":"summary.delta","text":"Summary.",…}
data: {"type":"compaction.done","reason":"context","mode":"summarize","status":"completed","usage":{…},"attempt":1,…}
data: {"type":"request.started","request":2,…}
```

### Agent API

#### Storage

The switch, the approval mode, and the keys do not go into Agent State — an Agent must not be able to turn on its own exposure or loosen its own approvals; nor into `.project_config.toml` — in company mode it synchronizes across servers, while external exposure can only be this server's own decision. They live in web.db, as one of the server-side add-on features PRN-024 speaks of: drop these two tables and an Agent's runs and history are unaffected.

- `agent_api`, primary key `(project_id, agent_id)`: `enabled` (the API tab's switch, default off), `open` (keyless access, default off), `approval_mode` (the approval mode taken **when an API session is created**, default `allow-all`), `updated_at`. A missing row means never configured: off, `allow-all`.
- `agent_api_keys`, one row per key: `key_id`, `project_id`, `agent_id`, `token_hash` (SHA-256, unique), `prefix` (the first 16 characters of the key), `name` (1–64 characters), `created_by`, `created_at`, `last_used_at` (stamped once per run request that authenticates with it).
- The administrator master switch: `agentApiEnabled` in `server_settings`, default on.
- Cascades: deleting an Agent deletes its settings and keys; deleting a Project, likewise.

#### Keys

- Shaped as `penguin_` plus 43 base64url characters (32 bytes of randomness), appearing exactly once in the creation response; afterwards only the name, the prefix, the creator, and the creation and last-use times are shown. An Agent may hold several; deletion is a hard delete; v1 sets no expiry.
- Authentication: take the `Bearer` value, SHA-256 it, and look it up by hash — a lookup over a fixed-length digest, whose cost is independent of the supplied value. The key's `(project_id, agent_id)` must match the path, otherwise 404 `agent_not_found`.
- A key grants only: starting runs on that Agent, and reading, aborting, and approving that Agent's API sessions. It cannot reach any route under `/api/*`, carries no Cookie, and represents no user; conversely, the local API token and the login Cookie likewise have no effect on `/api/amsp/v1`.

#### Routes

The public group: prefix `/api/amsp/v1`, `auth: "none"`, `order: 5`, sitting before the `/api/*` Cookie gate alongside `/api/auth` and `/api/desktop`.

```text
GET  /agents/:projectId/:agentId                  # 200 { agent }; the name and description are read from the Agent's config
POST /agents/:projectId/:agentId/runs             # { session_id?, input } → 200 SSE (this protocol), or an error from the table above
GET  /sessions/:sessionId                         # 200 { session }
POST /sessions/:sessionId/abort                   # 202 aborted / 204 no running Task
POST /sessions/:sessionId/approvals/:toolCallId   # { decision } → 204 / 404 approval_not_found
*    any other path                               # 404 not_found
```

The management group: prefix `/api/projects/:projectId/agents/:agentId/api`, `auth: "user"`; ownership is decided the same way as for deleting an Agent.

```text
GET    /             # any member: { api: { enabled, open, approvalMode, keys[] } }
PUT    /             # owner: { enabled?, open?, approvalMode? }
POST   /keys         # owner: { name } → 201 { key, secret }; the secret appears only this once
DELETE /keys/:keyId  # owner: 204 / 404 key_not_found
POST   /try          # owner: request and response as in the public group's runs; the logged-in identity stands in for the key, every other check (master switch, Agent switch, request body, resumption, concurrency limit) is the same as for a public run, and no key usage is recorded (the API tab's "Try it")
```

Each entry of the Agents list additionally carries `apiEnabled` (obtained in one query), feeding the API icon in the Agents list; `GET|PUT /api/admin/settings` gains `agentApiEnabled`. The Base URL (`${location.origin}/api/amsp/v1`) and the Agent ID (`${projectId}/${agentId}`) are computed by the Web App itself.

Every public request is checked in order, with steps 2–5 happening before the request body is read:

1. `OPTIONS` → 204 with CORS headers.
2. The administrator master switch is off → 403 `agent_api_disabled`.
3. An id in the path is malformed → 404.
4. `/agents/:p/:a/*`: the Agent's switch must be on, otherwise 404 `agent_not_found`. `/sessions/:id/*`: the Session index row must have `client = api`; its `(project_id, agent_id)` is the owning Agent, and that Agent's switch must be on, otherwise 404 `session_not_found`.
5. With `Authorization` → look up the key (unknown → 401; belonging to another Agent → 404); without it → keyless access must be on, otherwise 401 ("This Agent requires an API key.").
6. Read and validate the request body (400).
7. Handle it.

#### One run

1. Without `session_id`: if the Agent already has 4 running Sessions, 429; otherwise create a Session — `source: "api"`, `client: "api"`, the approval mode taken from the Agent's API approval mode, the model from the Project default, the sandbox as usual from the server's sandbox-setting default, snapshotted at creation — the same as a new conversation opened from the input area, minus the per-run UI choices. With `session_id`: step 4 has already confirmed it belongs to this Agent; whether it is idle is decided when the Task starts.
2. Subscribe to the Session channel first and start the Task second, so the first event is not missed. If starting fails (409 / 503), unsubscribe and answer with JSON; nothing of the stream has been written yet. A Trace-less Session that self-heals into a rebuild with a new id at startup: resubscribe to the new id — the engine's first output comes after the MCP connection, so nothing in between is missed; if even that cannot be kept up with, end with `run.done { status: "fatal", error: { code: "session_rebuilt" } }`, giving the new id in the message.
3. Write `run.started`; from then on every channel event is written out through the translator, and every write resets the keep-alive timer; after `run.done` is written, write `[DONE]` and finish.
4. The caller disconnects while the run is unfinished → abort the Task. Any exception thrown while driving → make a best effort to write `run.done { status: "fatal", error: { code: "internal" } }` and `[DONE]`, and log it and record the exception.

The seams it uses — `startTask`, `abortTask`, `statusOf`, `decideApproval`, `activeCountForAgent`, and the Session channel — are the same set the messaging bridge and the web routes use; `SessionManager` and core change nothing for this.

#### Sessions

- **Creation** goes only through a run without `session_id`; the first event gives the id. `session_meta.source = api` is a durable fact in Trace, and the sidebar files the session into "Background sessions" on that basis; the index row's `client = api` records "which program created this row", and resumption validation reads it. The two axes do not derive from each other; the values of session source and the sidebar's grouping are defined by the session-source changes.
- **Resumption**: the `session_id` must point to a Session that belongs to that Agent and has `client = api`; Web, CLI, and organization sessions all get 404 `session_not_found`. The reverse is unrestricted: a person can open an API session in the Web App, read it, approve, and keep typing.
- The title is generated automatically from the first input; usage and cost are recorded per Request as usual, spent against the Project's model credentials; the driver is not recorded, as with runs started by the local API token; the key records its creator.

#### Approvals

- One **API approval mode** per Agent — the same four as the input area's (`allow-all` / `read-only` / `always-ask` / `deny-all`) — chosen below the API tab's switch, default `allow-all`, stored in `agent_api.approval_mode`: an Agent writes only its own State directory and cannot reach web.db.
- **Read once, when the Session is created**, and written into that Session's index row; from then on the row is the truth, re-read on each decision as usual. A person can still tighten or loosen any one API session in the Web App; changes on the API tab affect only API sessions created afterwards, and the tab says so. This carries over the context-rotation principle's placement of the approval mode (the unrestricted layer, re-reading the Session row on each decision) while giving each Session a single place of storage; if every run re-read the Agent-level value, the next API call would overwrite a person's choice for an individual session — two stores contending on every call.
- **Why the default is `allow-all`**: first, consistency with the input area (a Session's approval mode already defaults to `allow-all`), as messaging-bot Sessions are today; second, the security boundary the product relies on is the sandbox (which the Agent cannot change, snapshotted at Session creation) — approval is oversight, and an API caller is a program, not a person reviewing diffs; third, asking modes matter only to callers that implement an approval callback — ask by default, and every command in one's first curl gets denied, which reads as broken; fourth, enabling the API is the owner's deliberate act after the key, with the mode choice right below the switch, visible the moment exposure happens. A cautious deployment flips to `read-only` in one click.
- Sandbox and model follow a new conversation's defaults; only the approval mode takes the Agent's API value. The approval mode in the Project's new-conversation defaults (`[default_chat]`'s `approval_mode`) is an input-area preference and does not apply to API sessions.
- **When asking is needed**: `approval_request` goes onto the Session channel as usual, the caller receives `approval.requested`, and answers via `POST /sessions/:id/approvals/:toolCallId`; the approval card in the Web page of that session can answer too — first answer wins. An API session has a stream watching it; it is not unattended — the "settled as denied on the spot" rule for organization sessions (`client = org`) does not apply. The server sets no timeout: the run waits until a decision, an abort, or a disconnect (a disconnect aborts, and pending approvals are denied with it). The SDK's default answer is `deny`.

#### Concurrency and interruption

- A busy Session gets 409 `task_in_progress` / `compacting`, with no queueing — a queued run would have no stream to answer on.
- Disconnecting aborts. "Keep running after the disconnect and pick it up later" is a different product (background jobs); see Future possibilities.
- An explicit abort (`POST /sessions/:id/abort`) keeps the stream open; the caller still receives `run.done { status: "aborted" }` and `[DONE]`.
- A run that creates a session answers 429 when the Agent already has 4 running Sessions (`AMSP_MAX_CONCURRENT_RUNS`, a code constant in v1); the count covers all running Sessions of that Agent.

#### Input and limits

Only text and `image_url` are accepted. Images are data URLs (image MIME, subject to the per-image inline limit and the administrator-set per-message total) or http(s) addresses (handed to the model as-is; the server does not fetch them); v1 does not accept files (400). The request-body limit follows `/api/*`; apart from the concurrency limit there is no rate limiting.

#### CORS

One middleware on the public group: `OPTIONS` always answers 204 with `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET, POST, OPTIONS`, `Access-Control-Allow-Headers: Authorization, Content-Type`, `Access-Control-Max-Age: 600`. Other requests attach `Access-Control-Allow-Origin: *` only when they carry `Authorization`, and it is set before handling, so streaming responses carry it too. Keyless requests carry no CORS headers at all: a browser page cannot drive, from another origin, an Agent that has keyless access open — otherwise any web page served from the loopback server could call it in passing. The existing CSRF line (write requests accept JSON only) stands; these routes use no Cookie.

#### Administrator master switch

`agentApiEnabled` defaults to on and is read from the database on each request (like `companyMode`). Once off, every public request (preflight excepted) answers 403 `agent_api_disabled`, and nothing is deleted; the switch on the API tab is greyed out with the reason noted, and the Agents list icon still shows.

#### UI and CLI

- The Agent settings page gains an "API" tab (after "Scheduled tasks"): the switch, the approval mode for API sessions, the Base URL and the Agent ID, the key list and the keyless-access switch, and curl / SDK examples filled in with the actual address; changes are owner-only. The Agents list adds an API icon for enabled Agents (a hover tip, not a text badge). The "Server" group of the system settings gains an "Allow Agent API" switch. At the end of the tab there is also a "Try it" (owner-only): an input box pre-filled with "What time is it?" and a "Run" button, which starts a real API run as the logged-in user via `POST …/api/try`, showing the event log (switchable to the raw `data:` lines), the answer, `run.done`'s status, usage, and `session_id`, and running it again resumes the session; a run can be stopped mid-flight, and asking-mode approvals are answered inline. See 06.
- `penguin agent api status | enable | disable | set | keys ls | keys create | keys rm | server on|off`: anything the UI can toggle, the CLI can toggle too; `keys create` prints the key alone to stdout. See 05 "CLI › Command surface".

#### Mounting

Under `packages/server/src/amsp/`: `module.ts` (contributes the public and management groups via `HttpModule.routes`, see PRFC-0001), `gate.ts` (the check order above), `routes.ts`, `run-stream.ts` (one run), `try-route.ts` ("Try it": through the same run handler, with the logged-in identity standing in for the key), `translate.ts` (the translator), `keys.ts` (issuance and hashing); storage is the `AgentApi` mechanism and its repo. Under the in-flight proposal that remounts the `/api/*` Cookie gate per route group (design [#195](https://github.com/Prism-Shadow/penguin-harness-design/pull/195)), `auth: "none"` holds just the same.

### SDK

`@prismshadow/amsp` (directory `packages/amsp`) is published publicly with zero runtime dependencies and works in both Node 24 and browsers (it uses only `fetch`, `ReadableStream`, `TextDecoder`, `AbortController`, `URL`). It exports all of AMSP's types, and the server imports it for types — this is the only copy of the protocol's types.

- `new AgentClient({ baseUrl, agent, apiKey?, fetch?, headers? })`: no `apiKey` means keyless access; no environment variable is read implicitly.
- `stream({ input, sessionId?, signal?, onApproval? })` returns a run: events can be read one by one with `for await`; `session` resolves at `run.started`; `result()` summarizes into `{ status, error?, sessionId, text, items, usage, sessionUsage, requests }` — `text` is the main session's assistant `text.done`s joined with blank lines, and `items` is all `.done` items plus the non-item events (a streamed compaction summary has no `.done`, so it is not there, and it is not rebuilt from fragments); `abort()` goes through the abort route.
- `run(opts)` starts a run and awaits its `result()`; there are also `agent()`, `session(id)`, `abort(id)`, `approve(id, toolCallId, decision)`, `parseArguments(toolCall)` (returns null on parse failure), and `readSse(body)`.
- Behavior: `[DONE]` ends iteration; comment lines and non-`data:` fields are ignored, and multi-line `data:` is joined with newlines; a non-200 before the stream starts throws `AmspHttpError { status, code, message }`; a stream that ends without `run.done` throws `AmspStreamError`; unknown event types are handed over as-is; even when the caller only awaits `result()`, `onApproval` is awaited and POSTed on its behalf — a throwing callback answers `deny`, and no callback likewise answers `deny`; an aborted `signal` cancels the read and rejects with fetch's `AbortError`.
- Published to npm by the release workflow (trusted publishing); the package name's very first publish is done once by hand by a maintainer, after which the trusted publisher can be configured.

### Compatibility

No on-disk data changes shape: the two new tables are created with `CREATE TABLE IF NOT EXISTS`; `sessions.client` is a free-text column, and the new value `api` needs no migration; a missing `server_settings` row means the default. Making `session_meta.source` required and tolerating old Traces on read are carried by the session-source changes; this proposal adds no compatibility code of its own.

## Drawbacks
[drawbacks]: #drawbacks

- **Keyless access.** With it on, any program that can reach the address can talk to that Agent, spend the Project's model quota, and run commands within what the sandbox allows. The mitigations go only this far: per-Agent enablement, default off, a UI warning "recommended for local use only", and no CORS headers on keyless requests. When the server listens on a non-loopback address, this is a public endpoint.
- **One connection per run.** The run lives and dies with the HTTP connection: long tasks must stay connected, and the intermediaries must tolerate long-lived connections (the keep-alive comment only guards against idle timeouts); a disconnect aborts, and v1 has no event ids — no resumption, no decoupling.
- **`allow-all` by default.** A program holding a key is not subject to per-command approval inside the sandbox. This is a deliberate trade-off (see "Approvals"); the cost is that the owner must understand the weight of "Enable API access".
- **Two axes.** Whether a Session is an API session is recorded twice — once by `client`, once by `source`: the former for the server's gate, the latter for the sidebar. The two happen to agree here, but the code has to know which one to read.
- **`tool_call` arguments are a string.** Unlike MMSP, which parses the arguments into an object, the caller must parse them (the SDK provides `parseArguments`).
- **The concurrency limit is a code constant**, not adjustable by the deployer.

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

- **Reuse `/api/sessions`, adding scoped tokens.** It looks like the smallest change, but the internal wiring thereby becomes a public contract: the start / stop of `partial_*`, `resync_required`, the set of server-event kinds — any internal adjustment turns into a breaking change; and every internal route needs a token-scope audit, where one missed route is one privilege escalation. A separate projection lets the internal stream keep evolving freely, with the external contract bound only by the `/v1` rules.
- **WebSocket.** Bidirectional; approvals and aborts could ride the same connection. But MMSP uses SSE, which curl, reverse proxies, browsers, and Node's `fetch` streaming reads all handle directly; one POST each for approval and abort is simple enough. Left as a future alternative transport.
- **Background jobs (poll after `202`, or pick up the stream later).** A disconnect would not mean an abort, and long tasks would not need to hold a connection. But that is a different product — results must be stored, expired, and listed — and it needs event ids and resumption. v1 takes the simplest "one request, one run"; jobs wait until the need appears.
- **Store the switch in Agent State or `.project_config.toml`.** The former would let an Agent turn on its own exposure and loosen its own approvals; the latter synchronizes across servers in company mode, so a switch on one server would appear on another. Hence web.db.
- **Approvals defaulting to `always-ask` or `read-only`.** More conservative, but most API callers do not implement an approval callback, and asking by default would deny every command in a first try; `read-only` is one click away.
- **Re-read the Agent-level approval mode on every run.** It would make API tab changes take effect on all API sessions immediately, at the cost of overwriting a person's per-session changes.
- **Queue when busy** (the messaging bridge's `queueIfBusy`). The bridge can queue because replies go back through chat; an API reply exists only on this one stream, and a queued run would have nowhere to answer.
- **Parse `tool_call` arguments into an object.** Either the server parses, needing yet another shape when parsing fails; or it rebuilds from fragments, which violates "fragments and complete calls, never reconciled". Keeping the string as-is is simplest; parsing is left to the SDK.
- **Do nothing.** External programs would be left with the local API token against internal APIs — admin privileges, plus an unstable wiring.

## Prior art
[prior-art]: #prior-art

- **The MMSP server** (agenthub): the prototype of wire discipline — items close with `.done`, exactly one terminating event, `: keep-alive`, an error envelope and status table, usage read at the end, open when no key is configured and stated at startup. AMSP inherits all of these, scaling the unit from one call up to one run.
- **The OpenAI Responses API's streaming output**: flat SSE events distinguished by `type`, `<subject>.<phase>` event names (e.g. `response.output_text.delta` / `.done`), and one summarizing completion event. AMSP's naming shares this shape.
- **Anthropic's Agent SDK**: hands the agent loop (multiple model calls and tool executions) to the caller as one message stream, with tool permission decided by a callback. `onApproval` is the same idea; the loop merely runs on the server, and the callback makes an HTTP round trip.
- **This repository**: the messaging bridge is the nearest precedent — subscribing to the Session channel, delimiting runs with `task_state`, taking approvals via `approval_request`, starting work with `startTask`; exactly these seams are what this proposal uses. The browser extension's pairing token stores only a SHA-256 hash and is revocable; `companyMode` and `browserExtensionsEnabled` are precedents for site-wide switches in `server_settings`.

## Unresolved questions
[unresolved-questions]: #unresolved-questions

There are no open questions. The four questions left by the first draft were decided by the user on 2026-10-07, and this document is written accordingly:

1. **Keyless access**: allowed, as a per-Agent "Allow keyless access" switch, default off, with a warning; the CORS rules unchanged (keyless requests carry no `Access-Control-Allow-Origin`).
2. **Approvals**: one API approval mode per Agent, four modes to choose from, default `allow-all`, stored in web.db where the Agent cannot change it; read once, when the Session is created. When asking is needed, the approval request is streamed to the caller, and the Web App can answer it too. The sandbox takes the server's default as usual, and the approval mode in the Project's new-conversation defaults does not apply to API sessions.
3. **Session source**: no separate sidebar marker for `client: "api"`; instead `session_meta.source` becomes required, with API sessions writing `api`; the sidebar files API / scheduled / sub-agent / CLI sessions into the same "Background sessions" subfolder. This part is carried by a separate design change for session source.
4. **SDK package name**: `@prismshadow/amsp`, directory `packages/amsp`, class name `AgentClient`.

## Future possibilities
[future-possibilities]: #future-possibilities

Background-job-style runs (poll after `202`, or pick up the stream later); file uploads via the API; per-key rate limits and expiry; a Python client; `GET /sessions/:id/messages` returning history as AMSP `.done` items; steering mid-run; WebSocket transport; an Agent-level override that sets a separate sandbox for API sessions.

## Changes

### v1.0.0

- Added: Migrated into the main repository; the body takes the landed version from the design repository's default branch, identical to the source file.

### v1.1.0

- Updated: The example in the Guide-level explanation and the SDK section use the two SDK entry points released in 0.2.16 (impl [#1111](https://github.com/Prism-Shadow/penguin-harness/pull/1111)): the old `run()`, which returns a run to iterate, is now `stream()`, and the old `ask()`, which runs and awaits the result, is now `run()`. The design repository records the same change as a Status note (design [#376](https://github.com/Prism-Shadow/penguin-harness-design/pull/376)).
