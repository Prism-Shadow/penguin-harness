# The API path: a program that calls a Penguin Agent

Read this before you write a program that calls a Penguin Agent over the Agent API. The rules in SKILL.md, *The API path*, hold throughout. The user documentation has every detail: the [Agent API guide](https://penguin.ooo/docs/agent-api) and the [AMSP protocol](https://penguin.ooo/docs/amsp).

## 1. Hand the opening to the user

Check first. This command only reads:

```bash
penguin agent api status --agent-id <agentId> --json
```

It prints one line of JSON: `agent` (the Agent ID), `baseUrl`, `api` (`enabled`, `open`, `approvalMode`, `keys`) and `serverEnabled`. A key's secret is never in it.

When `api.enabled` is false, or `api.keys` is empty and `api.open` is false, the program cannot run yet. Give the user these steps with the Agent's id filled in. Only the Project's owner can take them.

1. Open the Agent's settings and select the **API** tab (`/agents/<agentId>?tab=api`).
2. Turn on **Enable API access**.
3. Choose the **Approval mode for API conversations** (see the table below).
4. Under **Keys**, select **New key**, name it after the program, and copy the key. It is shown once.
5. Give the key to the program as the environment variable `PENGUIN_AGENT_KEY`.

The same steps in the user's own terminal, never in yours:

```bash
penguin auth login
penguin agent api enable --agent-id <agentId> --approve <mode>
export PENGUIN_AGENT_KEY="$(penguin agent api keys create --agent-id <agentId> --name <program>)"
```

`keys create` prints the key alone on stdout, so the variable takes it without showing it. These commands change the Agent's exposure, so they take the user's sign-in: `penguin auth login` once, or `penguin auth token` on the server's machine. From your shell the server refuses them with `403 human_required`. Never sign in or mint a session to get past that.

When `serverEnabled` is false, the server's administrator has turned the Agent API off, and every request is refused with `403`. Only an administrator turns it back on, in **Settings › Server › Agent API**.

Suggest the approval mode that fits the program, and say why in one line:

| The program | Mode | What happens |
| --- | --- | --- |
| Has no one to ask: a batch job, a backend | `allow-all` (the default) | Every tool call runs, inside the sandbox |
| May let the agent read but nothing more | `read-only` | Read-only tools run; every other call waits for the program's answer |
| Shows every tool call to its own user | `always-ask` | Every call waits for the program's answer |
| Must never run a tool | `deny-all` | Every call is denied; the agent answers without tools |

A call that waits is listed by the conversation's approvals resource, `GET <Base URL>/sessions/<session_id>/approvals`, and the run waits, with no time limit, for an answer, an abort or a disconnect. The `@prismshadow/amsp` client polls that resource and answers with `onApproval`, or with `deny` when there is none. The mode is read when an API conversation is created; a change on the tab applies to conversations created after it.

Leave **Allow keyless access** off unless the user asks for it. With it on, anything that can reach the server can run the Agent on the Project's models.

To run the program yourself, you need the key in your environment. Ask the user to add it to your key vault as `PENGUIN_AGENT_KEY`: the gear icon on your card on the Agents page, then the key vault tab. Vault values reach your shell on the next task. Until then, the program is unverified.

## 2. The connection values

| Value | Where it comes from | In the program |
| --- | --- | --- |
| Base URL | **Connection** on the API tab, or `baseUrl` from `status` | A constant, which `PENGUIN_AGENT_URL` can override |
| Agent ID | **Connection** on the API tab, or `agent` from `status`: `<projectId>/<agentId>` | A constant |
| Key | Created by the owner, shown once | `process.env.PENGUIN_AGENT_KEY`, and nowhere else |

- A local server's Base URL is `http://localhost:7364/api/amsp/v1`; `status` prints the server's real port. Use `localhost`, never `127.0.0.1`: a local server serves previews on `127.0.0.1` and answers every API request there with `401`.
- Do not give the program's settings the names the harness sets inside a session: `PENGUIN_API_URL`, `PENGUIN_API_TOKEN`, `PENGUIN_PROJECT_ID`, `PENGUIN_AGENT_ID`, `PENGUIN_SESSION_ID`. They name the session's own server and Agent, and they override a vault entry of the same name.

## 3. TypeScript: `@prismshadow/amsp`

```bash
npm install @prismshadow/amsp
```

Use a version after 0.2.16, which reads the current stream; 0.2.16 and earlier read the old events and cannot. The package is versioned with PenguinHarness, so match it to the server: a server of 0.2.16 or earlier needs the client of the same version. The client has no dependencies and runs in Node 24 and in current browsers. If your registry does not have the package, call the API over HTTP as in section 4.

```ts
import { AgentClient, isModelMessage, parseArguments } from "@prismshadow/amsp";

const apiKey = process.env.PENGUIN_AGENT_KEY;
if (!apiKey) throw new Error("Set PENGUIN_AGENT_KEY to the key from the agent's API tab.");

const client = new AgentClient({
  baseUrl: process.env.PENGUIN_AGENT_URL ?? "http://localhost:7364/api/amsp/v1",
  agent: "demo/coder", // <projectId>/<agentId>
  apiKey, // the client reads no environment variable itself
});

// One question, the whole answer.
const first = await client.run({ input: "Summarize README.md" });
if (first.status !== "completed") throw new Error(`${first.status}: ${first.error?.message ?? ""}`);
console.log(first.text);

// The same conversation, streamed: pass its Session id back.
const run = client.stream({
  sessionId: first.sessionId,
  input: "Now list its headings",
  onApproval: (toolCall, origin) => {
    const args = parseArguments(toolCall);
    return !origin && toolCall.name === "exec_command" && args?.cmd === "ls" ? "allow" : "deny";
  },
});
for await (const record of run) {
  // A record without `origin` is the main conversation's; a subagent's carry one.
  if (record.origin || !isModelMessage(record)) continue;
  if (record.payload.type === "partial_text") process.stdout.write(record.payload.text);
}
const second = await run.result();
```

- The stream carries the conversation's records: AMSP record envelopes `{timestamp, type, payload, origin?}`, the same lines the Trace stores. The answer streams as `partial_text` records and arrives whole as an assistant `text` record.
- `run()` runs to the end and resolves with the result: `status`, `error`, `sessionId`, `text` (the main conversation's answer), `usage`, `sessionUsage` and `requests`. `stream()` starts the run and returns it at once: iterate it once for the records, await `run.session` for the Session id, and `run.result()` for the end.
- **Conversations.** Keep one `sessionId` per conversation of the program, such as one per end user or chat thread, and pass it back to continue. Omit it to start a new conversation. Only the Agent's own API conversations can be continued.
- **Approvals.** `onApproval(toolCall, origin, { sessionId })` is called only when the approval mode makes a call wait; `origin` is set for a subagent's call. Without it, or when it throws, the client answers `deny`. A person can answer the same call in the Web App; the first answer counts.
- **Aborting.** Abort the `signal` passed to `stream()` or `run()` to drop the connection: the server aborts the run. `run.abort()` asks the server to abort and keeps the stream until `[DONE]`; the result's `status` is `aborted`.
- **Failures.** A refusal before the stream starts rejects with `AmspHttpError` (`status`, `code`, `message`; see section 5). After that, `result()` resolves for every run that reached `[DONE]`: check `status` (`completed`, `aborted`, `retryable` or `fatal`) and `error`. A stream that breaks before `[DONE]` rejects with `AmspStreamError`.
- **Unknown records** are passed through. Switch on `payload.type` with a default branch.
- **Following a conversation** that runs elsewhere, or across many runs: `SessionReader` reads its history and then its live records, and reconnects on its own.
- **A web app** keeps the key on its own server. The page posts to the app's server, which runs the Agent and relays the answer's `partial_text` to the page over SSE, aborting through `signal` when the page disconnects: the shape of the RAG recipe's `server.ts`. A key inside a page is readable by everyone who loads the page.

## 4. Any language: HTTP and curl

```bash
BASE="${PENGUIN_AGENT_URL:-http://localhost:7364/api/amsp/v1}"

# Start a conversation. The answer streams back as it is produced.
curl -N "$BASE/agents/demo/coder/runs" \
  -H "Authorization: Bearer $PENGUIN_AGENT_KEY" -H "Content-Type: application/json" \
  -d '{"input":"Summarize README.md"}'

# Continue it with the session_id that its first record, the session_meta, carried.
curl -N "$BASE/agents/demo/coder/runs" \
  -H "Authorization: Bearer $PENGUIN_AGENT_KEY" -H "Content-Type: application/json" \
  -d '{"session_id":"<session_id>","input":"Now list its headings"}'

# List the calls waiting for an answer, holding the request up to 30 seconds.
curl "$BASE/sessions/<session_id>/approvals?wait=30" \
  -H "Authorization: Bearer $PENGUIN_AGENT_KEY"

# Answer one while its run is still streaming.
curl -X POST "$BASE/sessions/<session_id>/approvals/<tool_call_id>" \
  -H "Authorization: Bearer $PENGUIN_AGENT_KEY" -H "Content-Type: application/json" \
  -d '{"decision":"allow"}'
```

To read the stream in your own code:

- It is SSE. An event without an `event:` name is a record: its `id:` is `<epoch>-<seq>` and its `data:` one JSON envelope `{timestamp, type, payload, origin?}`. A named event is a control frame: `ping`, first and every 20 seconds. The run ends with `data: [DONE]`. Skip every event name and `payload.type` you do not know.
- The run's records go from `task_begin` to `task_end`. A new conversation's first run opens with its `session_meta`, whose `session_id` is the id to continue it with; a run that continues a conversation carries none. The answer is the assistant `text` records without an `origin`, or their `partial_text` fragments as they arrive.
- How the run went is in the records: an `abort` record means it was aborted; a `request_end` that is not `completed` and has no `retry_in_ms` gives its failure in `error_code` and `error_message`; a last `task_begin` with no `task_end` before `[DONE]` means the server failed. A body that ends without `[DONE]` means the connection broke.
- `POST <Base URL>/sessions/<session_id>/abort` aborts a run and keeps its stream open until `[DONE]`.
- `GET <Base URL>/sessions/<session_id>/stream` follows a conversation across runs; `POST <Base URL>/sessions/<session_id>/tasks` with `{"input": …}` starts a run on it without holding a connection, and its records arrive on that stream.

## 5. Errors

A request refused before the stream gets an HTTP status and `{"error": {"code": "…", "message": "…"}}`. Once the stream has started, the records carry the error instead.

| Status | `code` | Usually | What to do |
| --- | --- | --- | --- |
| 400 | `bad_request` | A malformed body | The message names the field |
| 401 | `unauthorized` | No key, a wrong or deleted key, or `127.0.0.1` in the Base URL | Check `PENGUIN_AGENT_KEY` and that the Base URL uses `localhost` |
| 403 | `agent_api_disabled` | The administrator turned the Agent API off | Ask the user to have an administrator turn it on |
| 404 | `agent_not_found` | API access is off, the Agent ID is wrong, or the key belongs to another Agent | Check with `penguin agent api status`, then ask the owner |
| 404 | `session_not_found` | The `session_id` is not one of this Agent's API conversations | Start a new conversation |
| 409 | `task_in_progress`, `compacting` | The conversation is still busy | Wait for its `[DONE]`: one run per conversation at a time |
| 409 | `resync_required` | A Session stream reopened with a `Last-Event-ID` the server no longer holds (it restarted, or moved past it) | Read the history again and reopen the stream without `Last-Event-ID`; `SessionReader` does this itself |
| 429 | `too_many_runs` | The Agent already has as many conversations running as its limit allows (4 by default), Web App ones included | Retry after `Retry-After` seconds |

## 6. Verify before you hand over

1. `penguin agent api status --agent-id <agentId> --json` shows `api.enabled` true and at least one key.
2. The key is in your environment: `test -n "$PENGUIN_AGENT_KEY" && echo set`. Never print the value.
3. Run the program once with a real input. The run ends with `status` `completed`, and the answer appears.
4. Tell the user where to find the conversation: **Settings › Archived chats** in the Web App, marked with the API icon. An API conversation stays archived until someone unarchives it, which moves it into the sidebar.

When step 1 or 2 is not done, finish the program anyway, report it as **unverified**, and end your reply with the owner's steps from section 1. Report the files with relative paths, how to run the program, the Agent ID it calls, the approval mode it expects, and your assumptions.
