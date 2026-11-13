# @prismshadow/amsp

AMSP (Agent Message Stream Protocol) is the stream of one PenguinHarness Session: its records exactly as the Trace holds them, the `partial_*` fragments streamed while a message is produced, and the `ping` heartbeat. This package defines it — the record types with their guards and builders (`@prismshadow/amsp/records`, also on the root), the message markers (`@prismshadow/amsp/markers`), the control frames, the shapes of the Agent API's requests and answers — and carries the client: `AgentClient` to run an agent, `SessionReader` to follow a conversation. No runtime dependencies; runs in Node 24 and in current browsers on `fetch`, `ReadableStream`, `TextDecoder` and `AbortController`.

The package is versioned with PenguinHarness. The versions after 0.2.16 read the stream PenguinHarness serves at `/api/amsp/v1` since the protocol was redefined around these records: they cannot read the events a server of 0.2.16 or earlier sends, and a client of 0.2.16 or earlier cannot read this stream. A dependency on `^0.2.16` picks up the new client on its next install; pin `0.2.16` to keep the old one.

## The stream

A stream is SSE. Every event is one of two kinds:

- a **record**: no `event:` name, an `id:` (`<epoch>-<seq>`), and `data:` one record envelope, `{timestamp, type, payload, origin?}`, payloads snake_case as the Trace stores them. `origin` names the subagent Session chain a record came through; the main Session's records have none;
- a **control frame**: `event: ping` (`{}`, at once and every 20 seconds), and `data: [DONE]`, a run stream's last line.

A reader ignores an event name and a `payload.type` it does not know. A run's records go from `task_begin` to `task_end`. No frame names a run's Session: a new Session's first run opens with its `session_meta`, whose `session_id` names it, and a run that continues a Session is on the `session_id` its request sent. There is no error frame: a run the server could not finish leaves its last `task_begin` unclosed before `[DONE]`, and a body that ends without `[DONE]` is a broken connection.

## The routes

Relative to the Agent API's base URL, such as `http://localhost:7364/api/amsp/v1`, with `Authorization: Bearer <key>` unless the agent allows keyless access:

| Route | What it does |
| --- | --- |
| `GET /agents/:projectId/:agentId` | The agent's id, name and description |
| `POST /agents/:projectId/:agentId/runs` | One run, `{session_id?, input}`, answered with its stream: `ping` … `[DONE]`. Disconnecting aborts it |
| `GET /sessions/:id` | An API Session's status and model |
| `GET /sessions/:id/stream` | The Session stream: records and `ping`, across runs; resumes from `Last-Event-ID` or `?lastEventId=`, or answers `409` `resync_required` when the id has left the buffer |
| `GET /sessions/:id/messages` | The history: whole, `?tailLimit=n`, or `?before=<cursor>&limit=n`; `live {cursor, fragments}` while it runs |
| `GET /sessions/:id/trace-image` | An image a windowed history page references |
| `GET /sessions/:id/approvals[?wait=1–60]` | The calls waiting for a decision, `{approvals: [{tool_call, origin?}]}`; `wait` holds the answer until one waits |
| `POST /sessions/:id/tasks` | `{input}` → `202`: a run that holds no connection, read on the Session stream; `409` when busy, never queued |
| `POST /sessions/:id/abort` | `202` interrupted, `204` nothing running; a run stream still ends with `[DONE]` |
| `POST /sessions/:id/approvals/:toolCallId` | `{decision: "allow" \| "deny"}` → `204`, or `404` `approval_not_found` |

A page signed in to the PenguinHarness server reads the same Session stream at `GET /api/sessions/:id/amsp` and the same approvals at `GET /api/sessions/:id/approvals`.

## Run an agent

```ts
import { AgentClient, isModelMessage } from "@prismshadow/amsp";

const client = new AgentClient({
  baseUrl: "http://localhost:7364/api/amsp/v1",
  agent: "demo/coder", // <projectId>/<agentId>
  apiKey: process.env.PENGUIN_AGENT_KEY,
});

const run = client.stream({ input: "Summarize README.md" });
for await (const record of run) {
  if (record.origin || !isModelMessage(record)) continue;
  if (record.payload.type === "partial_text") process.stdout.write(record.payload.text);
}
const first = await run.result();

const second = await client.run({
  sessionId: first.sessionId,
  input: "Now list its headings",
  onApproval: () => "allow", // without a callback, every call that waits is denied
});
console.log(second.text, second.usage.total);
```

- `stream()` starts the run and returns it: iterate it once for the records, await `session` for the Session id (the `sessionId` you passed, once the stream opens, or a new Session's, at its `session_meta`), `result()` for the outcome, and call `abort()` to have the server abort it. `run()` returns the result alone.
- `RunResult` is `{status, error?, sessionId, text, usage, sessionUsage, requests}`, read from the main Session's records. `status` is decided in order: the last `task_begin` unclosed, or no Task began, is `fatal` with code `internal`; an `abort` record is `aborted` (the turn cap's carries `max_turns`); a `request_end` or `compaction_end` that is not `completed`, carries no `retry_in_ms` and no later request followed gives its status and error (a response the retries never got past its output cap is `retryable` with code `output_truncated`); anything else is `completed`. `text` joins the main Session's assistant texts of the Requests that completed with a blank line, compaction summaries left out; `usage` sums every `token_usage.request`, subagents included; `sessionUsage` is the last main `token_usage.session`; `requests` counts the main `request_begin` records.
- `result()` resolves for every run whose stream reached `[DONE]`. A refusal before the stream rejects with `AmspHttpError` (`status`, `code`, `message`); a stream that ends or breaks before `[DONE]` rejects with `AmspStreamError`; aborting the `signal` rejects with its reason.
- `agent()`, `session(id)`, `messages(id, page?)`, `approvals(id, wait?)`, `abort(id)` and `approve(id, toolCallId, decision)` call the other routes; `parseArguments(toolCall)` reads a tool call's JSON arguments.

## Approvals

When the agent's approval mode makes a call wait, the client answers for you. While a completed `tool_call` on the stream has no `approval_decision`, it long-polls `GET …/sessions/:id/approvals?wait=30`, hands each returned call to `onApproval(toolCall, origin, { sessionId })` once, and posts the answer. No callback, or one that throws, answers `deny`. The loop stops when every call has its decision or the run ends; the engine records a decision for every call, the automatic ones included.

## Follow a conversation

`SessionReader` follows one Session as one ordered sequence: it subscribes to the Session stream, reads the history's latest Tasks, weaves in the `live` tail, skips what the history already delivered, and reconnects with `Last-Event-ID` when a stream that has pinged goes silent. A reconnect the server refuses `409` `resync_required` (the id has left its buffer, or it restarted) starts over as a first open, after a `reset`.

```ts
import { HttpTransport, SessionReader } from "@prismshadow/amsp";

const reader = new SessionReader(
  new HttpTransport({
    baseUrl: "http://localhost:7364/api/amsp/v1",
    apiKey: process.env.PENGUIN_AGENT_KEY,
  }),
  sessionId,
  { tailLimit: 20 },
);
reader.on("event", ({ record, id, source }) => render(record, source)); // source: "history" | "live"
reader.on("reset", () => clearView()); // the history follows again
reader.on("error", (err) => console.error(err)); // refused for good; the reader has stopped
```

Options: `tailLimit` (default 20), `streamPath` (default `/sessions/<id>/stream`), `watchdogMs` (default 50 000), `reconnectMs` (default 1 000). `close()` stops it.

## Transports and the browser build

Both clients go through a `Transport` (`stream`, `get`, `post`). `HttpTransport` is the one over `fetch`, with `{baseUrl, apiKey?, credentials?, fetch?, headers?}`; a host with a channel of its own implements the interface, and `deliver(frames, handlers)` hands an SSE body's frames to a stream's handlers. A page on the server's own origin reads the cookie door with `new HttpTransport({ baseUrl: "/api", credentials: "same-origin" })` and `streamPath: "/sessions/<id>/amsp"`.

The package also ships `dist/browser/amsp.js` (`@prismshadow/amsp/browser`), the root entry as one ES module with nothing to resolve, for a page that imports it by URL, and the same bytes as a string, `BROWSER_SOURCE` from `@prismshadow/amsp/browser-source`, for a server that serves it: a bundler that absorbs the server carries the string along, where a file beside a package would be left behind. A page on another origin needs a key: the server sends `Access-Control-Allow-Origin: *` only on requests that carry `Authorization`.

A workbench page gets both from the server that answers the workbench, beside its own `ui/` folder: `…/workbenches/<id>/sdk/amsp.js` is this browser build, and `…/workbenches/<id>/sdk/workbench.js` re-exports it with the cookie door already set up. `apiBase` is that server's API (`/api`, or `/server/<machineId>/api` for a machine's workbench), `transport` the `HttpTransport` on it, `followSession(id, { tailLimit? })` a `SessionReader` on `/sessions/<id>/amsp`, and `abortSession(id)` interrupts the running Task (`true` when one was running):

```js
// In a page under the workbench's ui/ folder.
const { followSession, abortSession } = await import("../sdk/workbench.js");
const reader = followSession(sessionId, { tailLimit: 5 });
reader.on("event", ({ record }) => {
  if (!record.origin) render(record); // the main Session's records; subagents carry an origin
});
stopButton.onclick = () => abortSession(sessionId);
```

## Reading a stream without the client

`readSse` yields a body's events as `{event, id, data}`; `frameOf` sorts one into a record, a control frame, `[DONE]` or a name AMSP does not define; `readAmsp` does both. `RunCollector` folds a run's records into the `RunResult` that `result()` returns:

```ts
import { readAmsp, RunCollector } from "@prismshadow/amsp";

// sessionId: the session_id the request sent, if any; a new Session is named by its session_meta.
const collector = new RunCollector({ sessionId });
for await (const frame of readAmsp(response.body!)) {
  if (frame.kind === "done") break;
  if (frame.kind === "record") collector.add(frame.record);
}
const result = collector.result(); // a stream that ended without [DONE] broke: check for it first
```

## From the client of 0.2.16 and the earlier v1 events

| Earlier | Now |
| --- | --- |
| `onApproval(request, ctx)` | `onApproval(toolCall, origin, ctx)` |
| `RunResult.items` | Removed |
| `run.started` | No frame: a new Session is named by its `session_meta`, a continued one by the `session_id` sent |
| `run.done` | `data: [DONE]`, the outcome read from the records |
| `context.opened`, `tools.ready` | `session_meta`, `tool_list_ready` |
| `request.started` / `request.done` | `request_begin` / `request_end`, usage from the `token_usage` before it |
| `K.delta` / `K.done` | `partial_*` (`start` / `delta` / `stop`) / the complete record (`tool_result` → `tool_call_output`) |
| `summary.*` | `partial_text` / `text` between `compaction_begin` and `compaction_end` |
| `approval.requested` / `approval.decided` | The approvals resource / `approval_decision` |
| `compaction.*`, `mcp_connect.*`, `hook.fired` | `compaction_begin` / `_end`, `mcp_connect_begin` / `_end`, `hook` |
| `: keep-alive` | `event: ping` |

## Documentation

- [AMSP](https://penguin.ooo/amsp): what the protocol is, at a glance
- [Agent API](https://penguin.ooo/docs/agent-api): turning an agent's API on, keys, approval modes, routes, errors, the client in Node and browsers
- [AMSP reference](https://penguin.ooo/docs/amsp): records, control frames, the streams, approvals, the result rule, the full table of earlier events

## Development

```bash
pnpm --filter @prismshadow/amsp build       # tsup → dist/ (exports point at dist)
pnpm --filter @prismshadow/amsp typecheck
pnpm --filter @prismshadow/amsp test
```

Part of [PenguinHarness](https://github.com/Prism-Shadow/penguin-harness) · Apache-2.0
