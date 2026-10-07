---
title: Agent API
description: Let a program talk to one agent over HTTP — turn on the agent's API, mint keys, and run it with curl or the @prismshadow/amsp client.
---

The Agent API lets a program outside PenguinHarness — a script, a service, a page in a browser — talk to one agent over HTTP. The program sends its input, reads the run as it happens as an [AMSP](/amsp) event stream, and continues the conversation by its Session id. A run uses the Project's models and credentials, is recorded like any other conversation, and appears in the sidebar's **Background** folder.

Where to go:

- To expose an agent, see [Turn on an agent's API](#turn-on-an-agents-api).
- To try it from a shell, see [Call it with curl](#call-it-with-curl).
- To call it from TypeScript, in Node or a browser, see [The amsp client](#the-amsp-client).
- For the event stream itself, event by event, see [AMSP](/amsp).

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
3. Choose the **Approval mode for API conversations**. See [Approval mode](#approval-mode).
4. Under **Keys**, select **New key**, name it and copy the key. It is shown once.
5. Copy the **Base URL** and the **Agent ID** under **Connection**. **Examples** holds a curl command and a TypeScript snippet with both filled in and `$PENGUIN_AGENT_KEY` in place of the key.

On the **Agents** page, an agent whose API is on carries an API icon after its name, with the tooltip **API access on**.

Turning **Enable API access** off refuses every request for the agent at once with `404` `agent_not_found`. Its keys and settings are kept for when it is turned back on.

These settings are stored by the server, outside the agent's state, so an agent can neither expose itself nor loosen its own approval mode.

### Approval mode

API conversations have their own approval mode, separate from the one the composer preselects:

| Mode | In the selector | What the calling program sees |
| --- | --- | --- |
| `allow-all` (default) | **Approve everything** | Every tool call runs; nothing waits on the caller |
| `read-only` | **Approve read-only** | Read-only tools run; every other call is sent to the caller as `approval.requested` and waits for an answer |
| `always-ask` | **Ask every time** | Every tool call waits for the caller's answer |
| `deny-all` | **Deny everything** | Every tool call is denied; the model reads the denial and carries on without it |

- The mode is read when an API conversation is created and stays with that conversation. A change on the tab applies to API conversations created afterwards. To change one existing conversation, open it in the Web App and change its approval mode there.
- A call that waits is sent to the caller and shown in the conversation in the Web App as well; whichever answers first decides. The run waits with no time limit: until an answer, an abort, or the caller disconnecting, which denies it.
- `allow-all` is the default because the sandbox already bounds what the agent can do, and a program usually has no one to ask. Choose `read-only` or `always-ask` when the program answers approvals; see [Approvals](#approvals).

An API conversation's sandbox comes from the server's new-chat defaults, as for any new conversation. The Project's preselected approval mode for new conversations does not apply to it.

### Keys

- A key is `penguin_` followed by 43 characters. It is shown once, when it is created; the server stores only its SHA-256.
- An agent can have several keys, each with a name. The list shows each key's name, its first characters, when it was created and when it was last used (**never** until its first run).
- Deleting a key revokes it: the next request that presents it is refused with `401`.
- A key belongs to one agent. It runs that agent and reads, aborts and answers the approvals of that agent's API conversations, and opens nothing else on the server. A key of another agent is refused with `404` `agent_not_found`.
- Send it as `Authorization: Bearer <key>`.

### Keyless access

**Allow keyless access** lets a request without a key run the agent. It is off by default, and a request that presents a key is still checked while it is on.

> [!WARNING]
> With keyless access on, anything that can reach the server's address can talk to the agent, with the Project's models and credentials. Turn it on only for a server that listens on loopback (`127.0.0.1`).

A browser page on another origin cannot use keyless access: the server sends no CORS header on a request without `Authorization`. See [In a browser](#in-a-browser).

## Call it with curl

```bash
curl -N http://localhost:7364/api/amsp/v1/agents/demo/coder/runs \
  -H "Authorization: Bearer $PENGUIN_AGENT_KEY" -H "Content-Type: application/json" \
  -d '{"input":"Summarize README.md"}'
```

The answer is the run, streamed as it happens: one `data:` line per event, then `data: [DONE]`. `-N` turns off curl's buffering so events print as they arrive. The first event, `run.started`, names the Session; the last, `run.done`, says how the run ended and what it counted:

```text
data: {"type":"run.started","at":"2026-10-07T10:00:00.000Z","session_id":"session-2026-10-07-10-00-00-3f9a1c2e","agent":"demo/coder"}
data: {"type":"request.started","at":"…","request":1}
data: {"type":"text.delta","at":"…","role":"assistant","text":"README.md describes"}
…
data: {"type":"run.done","at":"…","status":"completed","requests":1,"usage":{…},"session_usage":{…}}
data: [DONE]
```

To continue the conversation, send the Session id with the next input:

```bash
curl -N http://localhost:7364/api/amsp/v1/agents/demo/coder/runs \
  -H "Authorization: Bearer $PENGUIN_AGENT_KEY" -H "Content-Type: application/json" \
  -d '{"session_id":"session-2026-10-07-10-00-00-3f9a1c2e","input":"Now list its headings"}'
```

## Routes

All paths are relative to the Base URL. A path under it that matches no route is answered `404` `not_found` in JSON.

| Method | Path | Answer |
| --- | --- | --- |
| GET | `/agents/:projectId/:agentId` | `{agent: {id, name?, description?}}` |
| POST | `/agents/:projectId/:agentId/runs` | The run as an event stream; see [AMSP](/amsp) |
| GET | `/sessions/:sessionId` | `{session: {id, agent, status, provider, model_id, created_at, last_active_at}}` |
| POST | `/sessions/:sessionId/abort` | `202` when a run was interrupted, `204` when none was running |
| POST | `/sessions/:sessionId/approvals/:toolCallId` | `{decision: "allow" \| "deny"}`; `204`, or `404` `approval_not_found` when it was already answered |

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
- Without `session_id`, the run starts a new conversation and `run.started` names it. With it, the run continues that conversation, which must be an API conversation of the same agent; any other id is `404` `session_not_found`.

### Conversations

- A new API conversation uses the Project's default model, the server's new-chat sandbox and the agent's API approval mode. Its title is generated from the first input, and its usage and cost count toward the Project, as for any conversation.
- The sidebar lists API conversations in the agent's **Background** folder, each marked with the API icon. You can open one, read it, answer its approvals and type into it.
- A conversation runs one thing at a time: a run on a conversation that is still working is refused with `409`. An agent runs at most four API runs at once; the fifth is refused with `429` and `Retry-After: 2`.
- Disconnecting aborts the run. To stop a run and still receive how it ended, `POST /sessions/:sessionId/abort`: the stream stays open and ends with `run.done` and `status: "aborted"`.

### Errors

A request refused before the stream starts gets an HTTP status and one envelope, `{"error": {"code": "<code>", "message": "<text>"}}`:

| Status | `code` | When |
| --- | --- | --- |
| 400 | `bad_request` | The body is not a JSON object; `input` is missing or empty; an item has an unknown `type`; `session_id` is not a valid id; an image is too large or not an image; `decision` is not `allow` or `deny` |
| 401 | `unauthorized` | The agent needs a key and none, or an unknown one, was presented. Checked before the body is read |
| 403 | `agent_api_disabled` | The administrator turned the Agent API off |
| 404 | `agent_not_found` | No such agent, its API is off, or the key belongs to another agent |
| 404 | `session_not_found` | No such Session, it is not an API conversation, or it belongs to another agent |
| 404 | `approval_not_found` | The approval was already answered, or never existed |
| 404 | `not_found` | No route at this path |
| 409 | `task_in_progress`, `compacting` | The conversation is busy |
| 413 | `payload_too_large` | The body exceeds the server's request size cap |
| 415 | `unsupported_media_type` | A write without `Content-Type: application/json` |
| 429 | `too_many_runs` | The agent already has four runs going; retry after `Retry-After` seconds |
| 503 | as the server sends it | The server is shutting down, or the agent or conversation is being deleted |

Once the stream has started, an error is never a separate frame: the run ends with `run.done`, whose `status` and `error` say what happened. See [Errors in the stream](/amsp#errors-in-the-stream).

## The amsp client

`@prismshadow/amsp` is the TypeScript client of the Agent API. It has no dependencies, runs in Node 24 and in current browsers, and exports the AMSP event types.

```bash
npm install @prismshadow/amsp
```

```ts
import { AgentClient } from "@prismshadow/amsp";

const client = new AgentClient({
  baseUrl: "http://localhost:7364/api/amsp/v1",
  agent: "demo/coder",
  apiKey: process.env.PENGUIN_AGENT_KEY,
});

const run = client.run({ input: "Summarize README.md" });
for await (const event of run) {
  if (event.type === "text.delta") process.stdout.write(event.text);
}
const first = await run.result();

const second = await client.ask({
  sessionId: first.sessionId,
  input: "Now list its headings",
  onApproval: () => "allow",
});
console.log(second.text, second.usage.total);
```

- `client.run()` starts the run at once and returns it. Iterate it for the events as they arrive — once; events are kept until read. `run.session` resolves with the Session id as soon as `run.started` arrives.
- `run.result()` resolves when the stream ends, with `status`, `error`, `sessionId`, `text`, `items`, `usage`, `sessionUsage` and `requests`. `text` is the main conversation's assistant answers joined with a blank line; a subagent's texts, user messages and compaction summaries stay out of it. `items` holds every event except the `.delta` fragments, in order.
- `client.ask()` runs to the end and returns the same result, keeping nothing for iteration.
- Leaving the loop early stops the iteration, not the run: approvals are still answered and `result()` still resolves. To stop the run, see [Aborting](#aborting).
- An event type the client does not know is passed through, so switch on `event.type` with a default branch.

### Approvals

When the approval mode makes a call wait, the run delivers `approval.requested` and the client answers it for you: with `onApproval`'s decision, or `deny` when there is no callback or it throws. It answers whether you iterate or only await the result.

```ts
import { AgentClient, parseArguments } from "@prismshadow/amsp";

const result = await client.ask({
  input: "Clean up the build output",
  onApproval: (request) => {
    const args = parseArguments(request.tool_call);
    return request.tool_call.name === "exec_command" && args?.command === "ls" ? "allow" : "deny";
  },
});
```

- `parseArguments` turns a tool call's arguments, which AMSP carries as the JSON string the model wrote, into an object: `{}` for none, `null` when they do not parse to an object.
- An approval someone already answered in the Web App is not an error. An answer the server refuses, such as with a key deleted mid-run, ends the run with that `AmspHttpError`, closing the connection so the server aborts the run rather than wait for good.
- `client.approve(sessionId, toolCallId, decision)` answers one by hand, for a program that reads the stream itself.

### Aborting

- Abort the `signal` passed to `run()` or `ask()` to drop the connection: the server aborts the run, and the run rejects with the signal's reason, an `AbortError` by default. Events not yet read are dropped.
- `run.abort()` asks the server to abort and keeps the connection: the stream ends with `run.done` and `status: "aborted"`, and `result()` resolves with it.
- `client.abort(sessionId)` does the same for a conversation by id, and returns whether a run was interrupted.

### When a run fails

- `result()` resolves for every run that reached `run.done`, whatever its `status`; check `status` and `error`.
- A refusal before the stream rejects with `AmspHttpError`, carrying `status`, `code` and `message` from the envelope. A body that is not the envelope gives `code: "http_error"` and a message with the status and the start of the body.
- A stream that ends or breaks before `run.done`, or carries a block that is not an AMSP event, rejects with `AmspStreamError`: the run's outcome is unknown, and `client.session(sessionId)` tells whether it is still running.
- A network failure and an abort reject as `fetch` raised them.

### In a browser

The same package works in a browser through a bundler. A page on another origin than the server needs a key: the server answers the CORS preflight for any origin, but sends `Access-Control-Allow-Origin: *` only on a request carrying `Authorization`. A cross-origin request may carry only `Authorization` and `Content-Type`, so extra `headers` are for same-origin pages and Node.

```ts
import { AgentClient } from "@prismshadow/amsp";

const keyField = document.querySelector<HTMLInputElement>("#key")!;
const client = new AgentClient({
  baseUrl: "http://localhost:7364/api/amsp/v1",
  agent: "demo/coder",
  apiKey: keyField.value,
});

const answer = document.querySelector("#answer")!;
for await (const event of client.run({ input: "What changed today?" })) {
  if (event.type === "text.delta") answer.textContent += event.text;
}
```

> [!WARNING]
> A key in a page is readable by everyone who loads the page. Use a browser client for a tool only you and your team open, with the key entered at run time, or keep the key on a backend that calls the agent for the page.

### Client reference

```ts
class AgentClient {
  constructor(opts: {
    baseUrl: string;              // ".../api/amsp/v1"
    agent: string;                // "<projectId>/<agentId>"
    apiKey?: string;              // omitted = keyless; no environment variable is read
    fetch?: typeof fetch;         // the global fetch by default
    headers?: Record<string, string>;
  });
  run(opts: RunOptions): Run;
  ask(opts: RunOptions): Promise<RunResult>;
  agent(): Promise<AgentInfo>;
  session(sessionId: string): Promise<SessionInfo>;
  abort(sessionId: string): Promise<boolean>;
  approve(sessionId: string, toolCallId: string, decision: "allow" | "deny"): Promise<void>;
}

interface RunOptions {
  input: string | InputItem[];
  sessionId?: string;
  signal?: AbortSignal;
  onApproval?: (
    request: ApprovalRequested,
    ctx: { sessionId: string },
  ) => "allow" | "deny" | Promise<"allow" | "deny">;
}

interface Run extends AsyncIterable<AmspEvent> {
  readonly session: Promise<string>;
  result(): Promise<RunResult>;
  abort(): Promise<void>;
}

interface RunResult {
  status: "completed" | "aborted" | "retryable" | "fatal";
  error?: { code: string; message: string };
  sessionId: string;
  text: string;
  items: AmspEvent[];
  usage: TokenCounts;
  sessionUsage: TokenCounts | null;
  requests: number;
}

function parseArguments(call: { arguments: string }): Record<string, unknown> | null;
function readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string>;
class AmspHttpError extends Error { status: number; code: string }
class AmspStreamError extends Error {}
```

`readSse` is the client's SSE reader, exported for a program that reads a run's body itself: it yields each event's data, `[DONE]` included.

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

## The admin switch

**Settings › Server › Agent API** holds the administrator's **Allow the Agent API** switch, on by default. Turning it off asks first, then refuses every Agent API request with `403` `agent_api_disabled`, the CORS preflight excepted. Agents' switches, approval modes and keys are kept, and every member sees the API tab's switch disabled with a note saying why. See [Agent API](/settings#agent-api) in Settings. The setting is `agentApiEnabled` in `GET`/`PUT /api/admin/settings`, and `penguin agent api server on|off` sets it from a terminal.
