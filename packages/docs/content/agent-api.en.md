---
title: Agent API
description: Let a program talk to one agent over HTTP — turn on the agent's API, mint keys, and run it with curl or the @prismshadow/amsp client.
---

The Agent API lets a program outside PenguinHarness — a script, a service, a page in a browser — talk to one agent over HTTP. The program sends its input, reads the run as it happens as an [AMSP](/amsp) stream of the conversation's records, and continues the conversation by its Session id. A run uses the Project's models and credentials, is recorded like any other conversation, and is archived by rule: it is listed under [Settings › Archived chats](/settings#archived-chats), and unarchiving it there keeps it in the sidebar.

Where to go:

- To expose an agent, see [Turn on an agent's API](#turn-on-an-agents-api).
- To try it from a shell, see [Call it with curl](#call-it-with-curl).
- To call it from TypeScript, in Node or a browser, see [The amsp client](#the-amsp-client).
- For the stream itself, record by record, see [AMSP](/amsp).

## Before you begin

- Only the Project's owner turns an agent's API on or off, chooses its approval mode and manages its keys. Members see the settings.
- The server's administrator can turn the whole Agent API off; it is on by default. See [The admin switch](#the-admin-switch).
- A program needs three things, all shown on the agent's **API** tab:
  - the **Base URL**, the server's address followed by `/api/amsp/v1`, such as `http://localhost:7364/api/amsp/v1` for a local server. On a server bound to loopback, which is the default, the address is `localhost`: `127.0.0.1` is where it serves previews, and it answers every API request there with `401`;
  - the **Agent ID**, `<projectId>/<agentId>`, such as `demo/coder`;
  - a **key**, unless the agent allows [keyless access](#keyless-access).

## Turn on an agent's API

1. Open the agent's settings (see [Agent settings](/agents#agent-settings)) and select the **API** tab, at `/agents/<agentId>?tab=api`.
2. Turn on **Enable API access**.
3. Under **New session settings**, choose the model, thinking level and workspace. Each choice saves immediately and applies to new API conversations. Leave them unset to use the Project default model, the Agent/Project thinking configuration and a temporary workspace. Choose the **Approval mode for API conversations** below; see [Approval mode](#approval-mode).
4. Under **Run settings**, enter a positive **Maximum concurrent runs** and select **Save**. The default is 4.
5. Under **Keys**, select **New key**, name it and copy the key. It is shown once.
6. Copy the **Base URL** and the **Agent ID** under **Connection**. **Examples** holds a curl command and a TypeScript snippet with both filled in and `$PENGUIN_AGENT_KEY` in place of the key.

On the **Agents** page, an agent whose API is on carries an API icon after its name, with the tooltip **API access on**.

Turning **Enable API access** off refuses every request for the agent at once with `404` `agent_not_found`. Its keys and settings are kept for when it is turned back on.

These settings are stored by the server, outside the agent's state, so an agent can neither expose itself nor loosen its own approval mode.

Changing them also takes a person's sign-in. The commands an agent runs carry the server's local API token: it reads these settings, but every change and **Try it** answer it `403` `human_required`, and so does the [admin switch](#the-admin-switch). This narrows what an agent can do from its own shell; it is not a boundary. A process that runs as the server's OS account outside the sandbox can still sign itself in, so what bounds an agent is its [sandbox](/settings#sandbox).

### Approval mode

API conversations have their own approval mode, separate from the one the composer preselects:

| Mode | In the selector | What the calling program sees |
| --- | --- | --- |
| `allow-all` (default) | **Approve everything** | Every tool call runs; nothing waits on the caller |
| `read-only` | **Approve read-only** | Read-only tools run; every other call waits for the caller's answer |
| `always-ask` | **Ask every time** | Every tool call waits for the caller's answer |
| `deny-all` | **Deny everything** | Every tool call is denied; the model reads the denial and carries on without it |

- The mode is read when an API conversation is created and stays with that conversation. A change on the tab applies to API conversations created afterwards. To change one existing conversation, unarchive it, open it in the Web App and change its approval mode there.
- A call that waits is listed by the conversation's approvals resource, `GET /sessions/:sessionId/approvals`, and, once you have unarchived the conversation, shown in it in the Web App as well; whichever answers first decides. Every call's decision then appears on the stream as an `approval_decision` record. The run waits with no time limit: until an answer, an abort, or the run stream's caller disconnecting, which denies it.
- `allow-all` is the default because the sandbox already bounds what the agent can do, and a program usually has no one to ask. Choose `read-only` or `always-ask` when the program answers approvals; see [Approvals](#approvals).

An API conversation's sandbox comes from the server's new-chat defaults, as for any new conversation. The Project's preselected approval mode for new conversations does not apply to it.

The two buttons above the examples open this usage guide and copy a prompt for a coding Agent. The prompt includes the current Base URL and Agent ID, with the key read from `PENGUIN_AGENT_KEY`.

### Keys

- A key is `penguin_` followed by 43 characters. It is shown once, when it is created; the server stores only its SHA-256.
- An agent can have several keys, each with a name. The list shows each key's name, its first characters, when it was created and when it was last used (**never** until its first run).
- Deleting a key revokes it: the next request that presents it is refused with `401`.
- A key belongs to one agent. It runs that agent and reads, follows, aborts and answers the approvals of that agent's API conversations, and opens nothing else on the server. A key of another agent is refused with `404` `agent_not_found`.
- Send it as `Authorization: Bearer <key>`.

### Keyless access

**Allow keyless access** lets a request without a key run the agent. It is off by default, and a request that presents a key is still checked while it is on. Switching it on asks first, with the warning below; `penguin agent api enable --open` and `set --open` print the same warning on stderr once it is on.

> [!WARNING]
> With keyless access on, anything that can reach the server's address can talk to the agent, with the Project's models and credentials. Turn it on only for a server that listens on loopback (`127.0.0.1`).

A browser page on another origin cannot use keyless access: the server sends no CORS header on a request without `Authorization`. See [In a browser](#in-a-browser).

### Try it

The **API** tab ends, for the Project's owner, with **Try it**: an input holding "What time is it now?" and **Run**. **Run** sends one real API run through `POST /api/projects/:projectId/agents/:agentId/api/try`, your sign-in standing in for a key and the same handler behind it, and shows the stream a program would receive in one output box. The box's header names the run's `session_id` and switches between two views: **Rendered**, one numbered row per record, with a message's fragments merged into the content they add up to (the answer, a tool call and its arguments, the tool's output), and **Raw**, one numbered line per event exactly as received. The strip under them gives the run's status, read from its records, with the Request count, tokens and elapsed time. The default agent can tell the time only by running `date`, so the example shows a tool call and its result. Running again continues the conversation, as a program does with `session_id`; **New conversation** starts another. **Stop** aborts the run through the Session's abort route, so the stream still ends with `[DONE]`, and when the approval mode asks, **Allow** and **Deny** appear on the call that waits. The conversation is an ordinary API conversation, archived like the others. While the administrator has the Agent API off, **Run** is disabled.

## Call it with curl

```bash
curl -N http://localhost:7364/api/amsp/v1/agents/demo/coder/runs \
  -H "Authorization: Bearer $PENGUIN_AGENT_KEY" -H "Content-Type: application/json" \
  -d '{"input":"Summarize README.md"}'
```

The answer is the run, streamed as it happens. `-N` turns off curl's buffering so events print as they arrive. A `ping` opens it, the conversation's records follow, each with an `id:`, from `task_begin` to `task_end`, and `data: [DONE]` ends the stream. On a new conversation the first record is its `session_meta`, whose `session_id` names the conversation:

```text
event: ping
data: {}

id: 7c41d0a2-1
data: {"timestamp":"…","type":"session_meta","payload":{"session_id":"session-2026-10-23-10-00-00-3f9a1c2e","provider":"…","model_id":"…",…,"source":"api"}}

id: 7c41d0a2-2
data: {"timestamp":"…","type":"event_msg","payload":{"type":"task_begin"}}

id: 7c41d0a2-4
data: {"timestamp":"…","type":"model_msg","payload":{"type":"text","role":"user","text":"Summarize README.md"}}

…

id: 7c41d0a2-9
data: {"timestamp":"…","type":"model_msg","payload":{"type":"partial_text","role":"assistant","event_type":"delta","text":"README.md describes"}}

…

id: 7c41d0a2-31
data: {"timestamp":"…","type":"event_msg","payload":{"type":"task_end"}}

data: [DONE]
```

The `session_meta` comes only on a conversation's first message. How the run went is read from its records; see [A run's result](/amsp#a-runs-result).

To continue the conversation, send that Session id with the next input:

```bash
curl -N http://localhost:7364/api/amsp/v1/agents/demo/coder/runs \
  -H "Authorization: Bearer $PENGUIN_AGENT_KEY" -H "Content-Type: application/json" \
  -d '{"session_id":"session-2026-10-23-10-00-00-3f9a1c2e","input":"Now list its headings"}'
```

## Routes

All paths are relative to the Base URL. A path under it that matches no route is answered `404` `not_found` in JSON.

| Method | Path | Answer |
| --- | --- | --- |
| GET | `/agents/:projectId/:agentId` | `{agent: {id, name?, description?}}` |
| POST | `/agents/:projectId/:agentId/runs` | The run as a stream; see [The run stream](/amsp#the-run-stream) |
| GET | `/sessions/:sessionId` | `{session: {id, agent, status, provider, model_id, created_at, last_active_at}}`, `status` being `idle`, `running` or `compacting` |
| GET | `/sessions/:sessionId/stream` | The conversation's records as they are written, across runs; see [The Session stream](/amsp#the-session-stream) |
| GET | `/sessions/:sessionId/messages` | The history, whole or a window of Tasks; see [History](/amsp#history) |
| GET | `/sessions/:sessionId/trace-image` | An image a history page references |
| GET | `/sessions/:sessionId/approvals` | `{approvals: [{tool_call, origin?}]}`, the calls waiting for an answer; `?wait=<1–60>` holds the answer until one waits. See [Approvals](/amsp#approvals) |
| POST | `/sessions/:sessionId/tasks` | `{input}` → `202` `{session_id}`: a run that does not hold the connection |
| POST | `/sessions/:sessionId/abort` | `202` when a run was interrupted, `204` when none was running |
| POST | `/sessions/:sessionId/approvals/:toolCallId` | `{decision: "allow" \| "deny"}`; `204`, or `404` `approval_not_found` when it was already answered |

Every `/sessions/:sessionId` route answers only for an API conversation of the agent the key belongs to; any other id is `404` `session_not_found`.

The API tab and `penguin agent api` manage the settings through `/api/projects/:projectId/agents/:agentId/api` and its `keys` routes, signed in as the Project's owner; see [Server API](/server-api).

### The run request

```ts
interface RunRequest {
  session_id?: string;        // continue this conversation; omit to start one
  input: string | InputItem[];
}
type InputItem =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: string }; // a data: URL, or an http(s) URL
```

- `input` must carry a non-empty text or an image.
- An image is a `data:` URL of an image type, within the 20 MB inline-image cap and the server's attachment total, or an `http(s)` URL, which goes to the model as it is. Files are not accepted.
- Without `session_id`, the run starts a new conversation, and its `session_meta`, the stream's first record, names it. With it, the run continues that conversation, which must be an API conversation of the same agent; any other id is `404` `session_not_found`.

### Run without holding the connection

`runs` ties a run to its connection: one request, one run, and closing the connection aborts it, which suits a script or a benchmark harness. A program that follows a conversation over time can connect first and run after:

1. Open the conversation's stream, `GET /sessions/:sessionId/stream`.
2. Send `POST /sessions/:sessionId/tasks` with `{"input": …}`, the same `input` as a run request. It answers `202` with `{"session_id"}`, and the run's records arrive on the stream, from `task_begin` to `task_end`.

- The run belongs to no connection: closing the stream does not abort it. `POST /sessions/:sessionId/abort` does.
- `tasks` continues an existing API conversation; a new one starts with `runs`. Goal mode is not offered here.
- A busy conversation answers `409`, and the input is not queued. The agent's concurrency limit applies as for `runs`.
- Under an approval mode that asks, nothing answers for you: if no one answers through the approvals resource or the Web App, the run waits for good.

### Conversations

- A new API conversation uses the model, thinking level, workspace and approval mode chosen on the agent's API tab, plus the server's new-chat sandbox. Its title is generated from the first input, and its usage and cost count toward the Project, as for any conversation.
- API conversations are archived by rule, so they are listed under [Settings › Archived chats](/settings#archived-chats) rather than in the sidebar. Unarchive one to read it, answer its approvals and type into it; it then stays in the sidebar through later runs, marked with the API icon. A program can continue an archived conversation, and it stays archived.
- A conversation runs one thing at a time: a run on a conversation that is still working is refused with `409`, and nothing is queued. The owner sets **Maximum concurrent runs** under **Run settings** on the API tab (default: 4, a positive integer). Running conversations, including those started in the Web App, and API conversations still starting count toward it. At the limit, a new API run or a run on an idle conversation is refused with `429` and `Retry-After: 2` before another conversation is created. Saving a new limit takes effect for subsequent requests and does not interrupt running conversations.
- Disconnecting from a run stream aborts the run. To stop a run and still receive how it ended, `POST /sessions/:sessionId/abort`: the stream stays open, its records end with `abort` and `task_end`, and it ends with `[DONE]`.

### Errors

A request refused before the stream starts gets an HTTP status and one envelope, `{"error": {"code": "<code>", "message": "<text>"}}`:

| Status | `code` | When |
| --- | --- | --- |
| 400 | `bad_request` | The body is not a JSON object; `input` is missing or empty; an item has an unknown `type`; `session_id` is not a valid id; an image is too large or not an image; `decision` is not `allow` or `deny`; `wait` is not a whole number; a history page's parameters are malformed |
| 401 | `unauthorized` | The agent needs a key and none, or an unknown one, was presented. Checked before the body is read |
| 403 | `agent_api_disabled` | The administrator turned the Agent API off |
| 404 | `agent_not_found` | No such agent, its API is off, or the key belongs to another agent |
| 404 | `session_not_found` | No such Session, it is not an API conversation, or it belongs to another agent |
| 404 | `approval_not_found` | The approval was already answered, or never existed |
| 404 | `not_found` | No route at this path |
| 409 | `task_in_progress`, `compacting` | The conversation is busy |
| 409 | `resync_required` | A Session stream's `Last-Event-ID` (or `lastEventId`) is no longer in the server's buffer; read the history and subscribe without it |
| 413 | `payload_too_large` | The body exceeds the server's request size cap |
| 415 | `unsupported_media_type` | A write without `Content-Type: application/json` |
| 429 | `too_many_runs` | The agent has reached its configured concurrency limit; retry after `Retry-After` seconds |
| 503 | as the server sends it | The server is shutting down, or the agent or conversation is being deleted |

Once the stream has started, an error is never a separate frame: the records say what happened, and a run the server could not finish leaves its last `task_begin` unclosed before `[DONE]`. See [A run's result](/amsp#a-runs-result) and the codes under [Errors](/amsp#errors).

## The amsp client

`@prismshadow/amsp` is the TypeScript client of the Agent API and the package that defines AMSP: the records with their guards and builders, the control frames, and the requests and answers around them; `@prismshadow/amsp/markers` holds the message markers. It has no dependencies and runs in Node 24 and in current browsers.

The package is versioned with PenguinHarness. The versions after 0.2.16 read the stream described on [AMSP](/amsp); they cannot read the events of a server from 0.2.16 or earlier, and a client from 0.2.16 or earlier cannot read this stream. An install that allows `^0.2.16` picks up the new client on its next install or update; see [Upgrading an older client](#upgrading-an-older-client).

```bash
npm install @prismshadow/amsp
```

```ts
import { AgentClient, isModelMessage } from "@prismshadow/amsp";

const client = new AgentClient({
  baseUrl: "http://localhost:7364/api/amsp/v1",
  agent: "demo/coder",
  apiKey: process.env.PENGUIN_AGENT_KEY,
});

const run = client.stream({ input: "Summarize README.md" });
for await (const record of run) {
  // Records without `origin` are the main conversation's; a subagent's carry one.
  if (record.origin || !isModelMessage(record)) continue;
  if (record.payload.type === "partial_text") process.stdout.write(record.payload.text);
}
const first = await run.result();

const second = await client.run({
  sessionId: first.sessionId,
  input: "Now list its headings",
  onApproval: () => "allow",
});
console.log(second.text, second.usage.total);
```

- `client.stream()` starts the run at once and returns it. Iterate it for the records as they arrive — once; records are kept until read. `run.session` resolves with the Session id once the run is under way: the `sessionId` you passed, as soon as the stream opens, or a new conversation's, at its `session_meta`, the stream's first record.
- `run.result()` resolves when the stream reaches `[DONE]`, with `status`, `error`, `sessionId`, `text`, `usage`, `sessionUsage` and `requests`; how each is read from the records is on [A run's result](/amsp#a-runs-result). `text` is the main conversation's assistant answers joined with a blank line; a subagent's texts, user messages and compaction summaries stay out of it.
- `client.run()` runs to the end and returns the same result, keeping nothing for iteration.
- Leaving the loop early stops the iteration, not the run: approvals are still answered and `result()` still resolves. To stop the run, see [Aborting](#aborting).
- A record whose `payload.type` the client does not know is passed through like any other, so give a switch on it a default branch.
- `client.agent()`, `client.session(sessionId)` and `client.messages(sessionId, page?)` read the agent, a conversation's status and model, and its history.

### Approvals

When the approval mode makes a call wait, the client answers it for you, whether you iterate or only await the result. While a completed `tool_call` on the stream has no `approval_decision` yet, the client keeps one request open on `GET …/sessions/:sessionId/approvals?wait=30`, hands each call it returns to `onApproval` once, and posts the answer. Without a callback, or when the callback throws, it answers `deny`. It stops once every call has its decision or the run ends.

```ts
import { parseArguments } from "@prismshadow/amsp";

const result = await client.run({
  input: "Clean up the build output",
  onApproval: (toolCall, origin) => {
    const args = parseArguments(toolCall);
    return !origin && toolCall.name === "exec_command" && args?.cmd === "ls" ? "allow" : "deny";
  },
});
```

- `onApproval(toolCall, origin, { sessionId })` receives the `tool_call` record's payload, the child Session chain for a subagent's call (`undefined` for the main conversation's), and the run's Session id.
- `parseArguments` turns a tool call's arguments, which a record carries as a JSON string, into an object: `{}` for none, `null` when they do not parse to an object.
- An approval someone already answered in the Web App is not an error. An answer the server refuses otherwise, such as with a key deleted mid-run, ends the run with that `AmspHttpError`, closing the connection so the server aborts the run rather than wait for good.
- `client.approvals(sessionId, wait?)` and `client.approve(sessionId, toolCallId, decision)` list and answer by hand, for a program that reads a stream itself.

### Aborting

- Abort the `signal` passed to `stream()` or `run()` to drop the connection: the server aborts the run, and the run rejects with the signal's reason, an `AbortError` by default. Records not yet read are dropped.
- `run.abort()` asks the server to abort and keeps the connection: the records end with `abort` and `task_end`, the stream with `[DONE]`, and `result()` resolves with `status: "aborted"`.
- `client.abort(sessionId)` does the same for a conversation by id, and returns whether a run was interrupted.

### When a run fails

- `result()` resolves for every run whose stream reached `[DONE]`, whatever its `status`; check `status` and `error`. A run the server could not finish resolves `fatal`, with code `internal`.
- A refusal before the stream rejects with `AmspHttpError`, carrying `status`, `code` and `message` from the envelope. A body that is not the envelope gives `code: "http_error"` and a message with the status and the start of the body.
- A stream that ends or breaks before `[DONE]`, or carries a record that is not an envelope, rejects with `AmspStreamError`: the run's outcome is unknown, and `client.session(sessionId)` tells whether it is still running.
- A network failure and an abort reject as `fetch` raised them.

### Following a conversation

`SessionReader` follows one conversation through its history and its live records as one ordered sequence. It subscribes to the Session stream, reads the history's latest Tasks, weaves in the `live` tail, skips records the history already delivered, reconnects with `Last-Event-ID` when a stream that has pinged stays silent for 50 seconds. A reconnect refused `409` `resync_required` starts over as a first open does, after a `reset`. It sees every run, whoever started it.

```ts
import { HttpTransport, SessionReader } from "@prismshadow/amsp";

const transport = new HttpTransport({
  baseUrl: "http://localhost:7364/api/amsp/v1",
  apiKey: process.env.PENGUIN_AGENT_KEY,
});
const reader = new SessionReader(transport, sessionId);
reader.on("event", ({ record, source }) => render(record, source));
reader.on("reset", () => clearView()); // what was delivered is void; the history follows again
reader.on("error", (err) => console.error(err)); // refused for good, such as a 404; the reader has stopped
```

- An `event` is `{record, id, source}`: `source` is `history` or `live`, and `id` is the stream's event id, `null` for a history record.
- Options: `tailLimit`, the Tasks read on open and on every resync (default 20); `streamPath`; `watchdogMs` (default 50 000); `reconnectMs` (default 1 000).
- `reader.close()` stops it.

### In a browser

The same package works in a browser through a bundler, and ships one ES module with nothing to resolve, `@prismshadow/amsp/browser` (`dist/browser/amsp.js`), for a page that imports it by URL; a server that serves it to its pages can take the same bytes as a string, `BROWSER_SOURCE` from `@prismshadow/amsp/browser-source`. A page on another origin than the server needs a key: the server answers the CORS preflight for any origin, but sends `Access-Control-Allow-Origin: *` only on a request carrying `Authorization`. A cross-origin request may carry only `Authorization` and `Content-Type`, so extra `headers` are for same-origin pages and Node.

```ts
import { AgentClient, isModelMessage } from "@prismshadow/amsp";

const keyField = document.querySelector<HTMLInputElement>("#key")!;
const client = new AgentClient({
  baseUrl: "http://localhost:7364/api/amsp/v1",
  agent: "demo/coder",
  apiKey: keyField.value,
});

const answer = document.querySelector("#answer")!;
for await (const record of client.stream({ input: "What changed today?" })) {
  if (record.origin || !isModelMessage(record)) continue;
  if (record.payload.type === "partial_text") answer.textContent += record.payload.text;
}
```

A page on the server's own origin can instead read a conversation with the user's sign-in, through the cookie door:

```ts
const transport = new HttpTransport({ baseUrl: "/api", credentials: "same-origin" });
const reader = new SessionReader(transport, sessionId, {
  streamPath: `/sessions/${encodeURIComponent(sessionId)}/amsp`,
});
```

A workbench page does not build this itself: it imports `../sdk/workbench.js`, which the server serves beside every workbench, and calls `followSession(sessionId)`. That module re-exports the browser build of the server answering, with `apiBase` and `transport` already set for its cookie door, for a workbench on another machine or behind a proxy prefix too, and adds `abortSession(sessionId)`. See [Workbench plugins](/skills#workbench-plugins).

> [!WARNING]
> A key in a page is readable by everyone who loads the page. Use a browser client for a tool only you and your team open, with the key entered at run time, or keep the key on a backend that calls the agent for the page.

### Client reference

```ts
class AgentClient {
  constructor(opts: {
    agent: string;                     // "<projectId>/<agentId>"
    baseUrl?: string;                  // ".../api/amsp/v1"; required without `transport`
    apiKey?: string;                   // omitted = keyless; no environment variable is read
    credentials?: RequestCredentials;  // passed to fetch, for the cookie door
    fetch?: typeof fetch;              // the global fetch by default
    headers?: Record<string, string>;
    transport?: Transport;             // in place of the HTTP transport the options above build
  });
  stream(opts: RunOptions): Run;
  run(opts: RunOptions): Promise<RunResult>;
  agent(): Promise<AgentInfo>;
  session(sessionId: string): Promise<SessionInfo>;
  messages(sessionId: string, page?: { tailLimit: number } | { before: string; limit?: number }): Promise<MessagesResponse>;
  approvals(sessionId: string, wait?: number): Promise<PendingApproval[]>;
  abort(sessionId: string): Promise<boolean>;
  approve(sessionId: string, toolCallId: string, decision: "allow" | "deny"): Promise<void>;
}

interface RunOptions {
  input: string | InputItem[];
  sessionId?: string;
  signal?: AbortSignal;
  onApproval?: (
    toolCall: ToolCallPayload,
    origin: string[] | undefined,
    ctx: { sessionId: string },
  ) => "allow" | "deny" | Promise<"allow" | "deny">;
}

interface Run extends AsyncIterable<AmspRecord> {
  readonly session: Promise<string>;
  result(): Promise<RunResult>;
  abort(): Promise<void>;
}

interface RunResult {
  status: "completed" | "aborted" | "retryable" | "fatal";
  error?: { code: string; message: string };
  sessionId: string;
  text: string;
  usage: TokenCounts;
  sessionUsage: TokenCounts | null;
  requests: number;
}

class SessionReader {
  constructor(transport: Transport, sessionId: string, opts?: {
    tailLimit?: number; streamPath?: string; watchdogMs?: number; reconnectMs?: number;
  });
  on(type: "event", listener: (e: { record: AmspRecord; id: string | null; source: "history" | "live" }) => void): () => void;
  on(type: "reset", listener: () => void): () => void;
  on(type: "error", listener: (error: unknown) => void): () => void;
  close(): void;
}

interface Transport {
  stream(path: string, req: StreamRequest): Promise<"done" | "closed">;
  get<T>(path: string, opts?: { signal?: AbortSignal }): Promise<{ status: number; body: T | null }>;
  post<T>(path: string, body?: unknown, opts?: { signal?: AbortSignal }): Promise<{ status: number; body: T | null }>;
}
class HttpTransport implements Transport {
  constructor(opts: { baseUrl: string; apiKey?: string; credentials?: RequestCredentials; fetch?: typeof fetch; headers?: Record<string, string> });
}

function readSse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<{ event: string | null; id: string | null; data: string }>;
function frameOf(event: { event: string | null; id: string | null; data: string }): AmspFrame;
function readAmsp(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<AmspFrame>;
type AmspFrame =
  | { kind: "record"; id: string | null; record: AmspRecord }
  | { kind: "control"; control: AmspControl }   // ping
  | { kind: "done" }                            // data: [DONE]
  | { kind: "other"; name: string; data: string };
class RunCollector {
  constructor(opts?: { sessionId?: string }); // the Session the run continued
  readonly sessionId: string | null;          // that Session, or a new one's from its session_meta
  add(record: AmspRecord): void;
  result(): RunResult;          // throws AmspStreamError when nothing named the Session
}
function parseArguments(call: { arguments: string }): Record<string, unknown> | null;
class AmspHttpError extends Error { status: number; code: string }
class AmspStreamError extends Error {}
```

`readAmsp` and `RunCollector` are for a program that sends the request itself, with its own `fetch`, credentials or URL, and wants the same result `result()` gives:

```ts
import { readAmsp, RunCollector } from "@prismshadow/amsp";

// sessionId: the session_id the request sent, if any; a new Session is named by its session_meta.
const collector = new RunCollector({ sessionId });
let done = false;
for await (const frame of readAmsp(response.body!)) {
  if (frame.kind === "done") { done = true; break; }
  if (frame.kind === "record") collector.add(frame.record);
}
if (!done) throw new Error("The stream ended before [DONE]: the connection broke.");
const result = collector.result();
```

A host with a channel of its own implements `Transport`; `deliver(frames, handlers)` hands a stream's frames to its handlers when it reads an SSE body itself.

### Upgrading an older client

A program written against the client of 0.2.16 or earlier changes as follows. Pin `@prismshadow/amsp@0.2.16` to keep the old client against an old server until the program has moved.

| 0.2.16 and earlier | After 0.2.16 |
| --- | --- |
| `onApproval(request, ctx)`, reading `request.tool_call` | `onApproval(toolCall, origin, ctx)` |
| Events: `run.started`, `text.delta`, `run.done`, … | Records and control frames; see [From the earlier v1 events](/amsp#from-the-earlier-v1-events) |
| `RunResult.items` | Removed: iterate the run, or read the history |
| `readSse` yields each event's data | `readSse` yields `{event, id, data}`; `readAmsp` yields frames |
| `RunCollector.add(event)`, `finished` | `new RunCollector({ sessionId })` for a continued Session, then `add(record)`; `[DONE]` marks the end |

## From the command line

`penguin agent api` manages an agent's API from a terminal, against the running server, with the same rules as the API tab:

| Command | What it does |
| --- | --- |
| `penguin agent api status --agent-id <id>` | Shows whether the API is on, keyless access, the approval mode, the Base URL, the Agent ID, the number of keys and the admin switch |
| `penguin agent api enable --agent-id <id> [--open \| --no-open] [--approve <mode>]` | Turns the API on, optionally setting keyless access and the approval mode |
| `penguin agent api disable --agent-id <id>` | Turns the API off |
| `penguin agent api set --agent-id <id> [--open \| --no-open] [--approve <mode>]` | Changes keyless access or the approval mode without turning the API on or off |
| `penguin agent api keys ls --agent-id <id>` | Lists the keys: id, name, first characters, created, last used |
| `penguin agent api keys create --agent-id <id> --name <name>` | Mints a key. The key alone goes to stdout, everything else to stderr, so `$(…)` captures just the key |
| `penguin agent api keys rm <keyId> --agent-id <id>` | Deletes a key |
| `penguin agent api server on\|off` | The admin switch |

Each command also takes `--project-id`, `--server` and `--json`. `--approve` takes the four modes: `allow-all`, `read-only`, `always-ask`, `deny-all`. See the [CLI Reference](/cli).

The commands that change something (`enable`, `disable`, `set`, `keys create`, `keys rm` and `server`) need your sign-in: run `penguin auth login` once, or `penguin auth token` on the server's machine. The server refuses them to the local API token, and the CLI then sends them again with that sign-in. Without it they print that hint and exit 1. `status` and `keys ls` need none.

## The admin switch

**Settings › Server › Agent API** holds the administrator's **Allow the Agent API** switch, on by default. Turning it off asks first, then refuses every Agent API request with `403` `agent_api_disabled`, the CORS preflight excepted. Agents' switches, approval modes and keys are kept, and every member sees the API tab's switch disabled with a note saying why. See [Agent API](/settings#agent-api) in Settings. The setting is `agentApiEnabled` in `GET`/`PUT /api/admin/settings`, and `penguin agent api server on|off` sets it from a terminal once you have signed in.
