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
penguin agent api enable --agent-id <agentId> --approve <mode>
export PENGUIN_AGENT_KEY="$(penguin agent api keys create --agent-id <agentId> --name <program>)"
```

`keys create` prints the key alone on stdout, so the variable takes it without showing it.

When `serverEnabled` is false, the server's administrator has turned the Agent API off, and every request is refused with `403`. Only an administrator turns it back on, in **Settings › Server › Agent API**.

Suggest the approval mode that fits the program, and say why in one line:

| The program | Mode | What happens |
| --- | --- | --- |
| Has no one to ask: a batch job, a backend | `allow-all` (the default) | Every tool call runs, inside the sandbox |
| May let the agent read but nothing more | `read-only` | Read-only tools run; every other call waits for the program's answer |
| Shows every tool call to its own user | `always-ask` | Every call waits for the program's answer |
| Must never run a tool | `deny-all` | Every call is denied; the agent answers without tools |

A call that waits reaches the program as an `approval.requested` event, and the run waits, with no time limit, for an answer, an abort or a disconnect. The `@prismshadow/amsp` client answers it with `onApproval`, or with `deny` when there is none. The mode is read when an API conversation is created; a change on the tab applies to conversations created after it.

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

The client has no dependencies and runs in Node 24 and in current browsers. If your registry does not have the package, call the API over HTTP as in section 4.

```ts
import { AgentClient, parseArguments } from "@prismshadow/amsp";

const apiKey = process.env.PENGUIN_AGENT_KEY;
if (!apiKey) throw new Error("Set PENGUIN_AGENT_KEY to the key from the agent's API tab.");

const client = new AgentClient({
  baseUrl: process.env.PENGUIN_AGENT_URL ?? "http://localhost:7364/api/amsp/v1",
  agent: "demo/coder", // <projectId>/<agentId>
  apiKey, // the client reads no environment variable itself
});

// One question, the whole answer.
const first = await client.ask({ input: "Summarize README.md" });
if (first.status !== "completed") throw new Error(`${first.status}: ${first.error?.message ?? ""}`);
console.log(first.text);

// The same conversation, streamed: pass its Session id back.
const run = client.run({
  sessionId: first.sessionId,
  input: "Now list its headings",
  onApproval: (request) => {
    const args = parseArguments(request.tool_call);
    return request.tool_call.name === "exec_command" && args?.command === "ls" ? "allow" : "deny";
  },
});
for await (const event of run) {
  // An event without `origin` is the main conversation's; a subagent's events carry one.
  if (event.type === "text.delta" && !event.origin) process.stdout.write(event.text);
}
const second = await run.result();
```

- `ask()` runs to the end and resolves with the result: `status`, `error`, `sessionId`, `text` (the main conversation's answer), `items`, `usage`, `sessionUsage` and `requests`. `run()` starts the run and returns it at once: iterate it once for the events, await `run.session` for the Session id, and `run.result()` for the end.
- **Conversations.** Keep one `sessionId` per conversation of the program, such as one per end user or chat thread, and pass it back to continue. Omit it to start a new conversation. Only the Agent's own API conversations can be continued.
- **Approvals.** `onApproval` is called only when the approval mode makes a call wait. Without it, or when it throws, the client answers `deny`. A person can answer the same request in the Web App; the first answer counts.
- **Aborting.** Abort the `signal` passed to `run()` or `ask()` to drop the connection: the server aborts the run. `run.abort()` asks the server to abort and still delivers the final `run.done`, with `status: "aborted"`.
- **Failures.** A refusal before the stream starts rejects with `AmspHttpError` (`status`, `code`, `message`; see section 5). After that, `result()` resolves for every run: check `status` (`completed`, `aborted`, `retryable` or `fatal`) and `error`. A stream that breaks before `run.done` rejects with `AmspStreamError`.
- **Unknown events** are passed through. Switch on `event.type` with a default branch.
- **A web app** keeps the key on its own server. The page posts to the app's server, which runs the Agent and relays the `text.delta` events to the page over SSE, aborting through `signal` when the page disconnects: the shape of the RAG recipe's `server.ts`. A key inside a page is readable by everyone who loads the page.

## 4. Any language: HTTP and curl

```bash
BASE="${PENGUIN_AGENT_URL:-http://localhost:7364/api/amsp/v1}"

# Start a conversation. The answer streams back as it is produced.
curl -N "$BASE/agents/demo/coder/runs" \
  -H "Authorization: Bearer $PENGUIN_AGENT_KEY" -H "Content-Type: application/json" \
  -d '{"input":"Summarize README.md"}'

# Continue it with the session_id that the first event, run.started, carried.
curl -N "$BASE/agents/demo/coder/runs" \
  -H "Authorization: Bearer $PENGUIN_AGENT_KEY" -H "Content-Type: application/json" \
  -d '{"session_id":"<session_id>","input":"Now list its headings"}'

# Answer an approval.requested event while its run is still streaming.
curl -X POST "$BASE/sessions/<session_id>/approvals/<tool_call_id>" \
  -H "Authorization: Bearer $PENGUIN_AGENT_KEY" -H "Content-Type: application/json" \
  -d '{"decision":"allow"}'
```

To read the stream in your own code:

- Each event is one `data: <JSON>` line followed by a blank line. After the last event comes `data: [DONE]`. A line that starts with `:` is a keep-alive comment, sent after 15 seconds of silence: skip it.
- The first event is `run.started`, with the `session_id`. The last is `run.done`, with `status`, `error` and `usage`. The answer is the assistant `text.done` events without an `origin`, or their `text.delta` fragments as they arrive.
- Skip every event `type` you do not know.
- `POST <Base URL>/sessions/<session_id>/abort` aborts a run and keeps its stream open until `run.done`.

## 5. Errors

A request refused before the stream gets an HTTP status and `{"error": {"code": "…", "message": "…"}}`. Once the stream has started, `run.done` carries the error instead.

| Status | `code` | Usually | What to do |
| --- | --- | --- | --- |
| 400 | `bad_request` | A malformed body | The message names the field |
| 401 | `unauthorized` | No key, a wrong or deleted key, or `127.0.0.1` in the Base URL | Check `PENGUIN_AGENT_KEY` and that the Base URL uses `localhost` |
| 403 | `agent_api_disabled` | The administrator turned the Agent API off | Ask the user to have an administrator turn it on |
| 404 | `agent_not_found` | API access is off, the Agent ID is wrong, or the key belongs to another Agent | Check with `penguin agent api status`, then ask the owner |
| 404 | `session_not_found` | The `session_id` is not one of this Agent's API conversations | Start a new conversation |
| 409 | `task_in_progress`, `compacting` | The conversation is still busy | Wait for its `run.done`: one run per conversation at a time |
| 429 | `too_many_runs` | The Agent already has 4 API runs going | Retry after `Retry-After` seconds |

## 6. Verify before you hand over

1. `penguin agent api status --agent-id <agentId> --json` shows `api.enabled` true and at least one key.
2. The key is in your environment: `test -n "$PENGUIN_AGENT_KEY" && echo set`. Never print the value.
3. Run the program once with a real input. The run ends with `status` `completed`, and the answer appears.
4. Tell the user where to find the conversation: the Agent's **Background** folder in the sidebar, marked with the API icon.

When step 1 or 2 is not done, finish the program anyway, report it as **unverified**, and end your reply with the owner's steps from section 1. Report the files with relative paths, how to run the program, the Agent ID it calls, the approval mode it expects, and your assumptions.
