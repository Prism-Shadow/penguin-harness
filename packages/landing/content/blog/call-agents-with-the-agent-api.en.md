---
title: "Connect agents to any external app through one unified API"
date: 2026-10-13
category: practice
excerpt: "Every agent in PenguinHarness answers on the same API. Turn it on, create a key, and any app can run the agent from curl or from TypeScript with the @prismshadow/amsp client: the run streams back as AMSP events, and the Session id it returns continues the conversation."
---

The Agent API connects your agents to any app outside PenguinHarness over HTTP, and it is the same API for every agent: the same endpoints, the same AMSP events and the same client, whichever agent you call. The app sends its input, reads a stream of AMSP events as the run happens, and continues the conversation by its Session id. Runs use the Project's models and credentials, and each one is recorded like any other conversation.

This tutorial exposes the default agent, asks it for the time from curl, then does the same from Node with the `@prismshadow/amsp` client.

## Prerequisites

- PenguinHarness 0.2.15 with a model configured on the **Models** page.
- The owner role in the Project. Only the owner turns an agent's API on and manages its keys.
- curl, or Node 24 for the client.

## Step 1: Turn on the agent's API

1. Open **Agents**, select the agent, and select the **API** tab.
2. Turn on **Enable API access**.
3. Leave **Approval mode for API conversations** at **Approve everything**, so tool calls run without waiting for an answer. With **Approve read-only** or **Ask every time**, a call that needs approval waits for the program to answer it.
4. Under **Keys**, select **New key**, type a **Key name**, and select **Create**. The key is shown once: copy it.

![The API tab: Enable API access on, the approval mode, the Base URL and Agent ID under Connection, and one key](/blog-assets/agent-api-tab-en.png)

**Connection** holds the other two things a program needs: the **Base URL**, which is your server's address followed by `/api/amsp/v1`, and the **Agent ID**, `<projectId>/<agentId>`. Put the key and the Base URL in your shell:

```bash
export PENGUIN_AGENT_KEY='penguin_…'                       # the key you copied
export PENGUIN_AGENT_URL=http://localhost:7364/api/amsp/v1  # your Base URL
```

Keep the address `localhost`: a server bound to loopback answers API requests on `127.0.0.1` with `401`.

## Step 2: Try it in the tab

At the end of the tab, **Try it** sends one real run through the same route a program calls, with your sign-in standing in for the key. Select **Run** and the stream appears below.

![Try it after one run: the agent runs date, reads the output and answers, and run.done reports two Requests](/blog-assets/agent-api-try-en.png)

## Step 3: Run the agent with curl

```bash
curl -N "$PENGUIN_AGENT_URL/agents/default_project/default_agent/runs" \
  -H "Authorization: Bearer $PENGUIN_AGENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"input":"What time is it now?"}'
```

The answer is the run itself, one `data:` line per event, ending with `run.done` and `data: [DONE]`. This is the stream that request returned with a scripted test model in place of a real one, shortened:

```text
data: {"type":"run.started","at":"2026-10-12T17:47:31.940Z","session_id":"session-2026-10-13-01-47-31-99795a84","agent":"default_project/default_agent"}
data: {"type":"tools.ready",…}
data: {"type":"request.started","at":"2026-10-12T17:47:31.960Z","request":1}
…
data: {"type":"tool_call.done","at":"2026-10-12T17:47:31.966Z","tool_call_id":"call_5ca97ddd648b680ebc5c83eb","name":"exec_command","arguments":"{\"description\":\"Read the server's clock\",\"cmd\":\"date\"}","stop_reason":"completed"}
…
data: {"type":"tool_result.done","at":"2026-10-12T17:47:32.042Z","tool_call_id":"call_5ca97ddd648b680ebc5c83eb","output":"Tue Oct 13 01:47:31 CST 2026\n","stop_reason":"completed"}
…
data: {"type":"text.done","at":"2026-10-12T17:47:32.061Z","role":"assistant","text":"It's 01:47 on October 13, 2026, by the server's clock (CST).","stop_reason":"completed"}
…
data: {"type":"run.done","at":"2026-10-12T17:47:32.095Z","status":"completed","requests":2,"usage":{"cache_read":5576,"cache_write":1024,"output":96,"total":6696},"session_usage":{"cache_read":5576,"cache_write":1024,"output":96,"total":6696}}
data: [DONE]
```

`-N` stops curl from buffering, so events print as they arrive. To continue the conversation, send the `session_id` from `run.started` with the next input:

```bash
curl -N "$PENGUIN_AGENT_URL/agents/default_project/default_agent/runs" \
  -H "Authorization: Bearer $PENGUIN_AGENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"session_id":"session-2026-10-13-01-47-31-99795a84","input":"And in UTC?"}'
```

```text
…
data: {"type":"text.done","at":"2026-10-12T17:47:32.127Z","role":"assistant","text":"That is 17:47 UTC on Monday, October 12.","stop_reason":"completed"}
…
```

A request without a key is refused before anything runs:

```text
{"error":{"code":"unauthorized","message":"This Agent requires an API key."}}
```

## Step 4: Run it from Node

Install the client in your project:

```bash
npm install @prismshadow/amsp
```

Save this as `ask.mjs`:

```js
import { AgentClient } from "@prismshadow/amsp";

const client = new AgentClient({
  baseUrl: process.env.PENGUIN_AGENT_URL,
  agent: "default_project/default_agent",
  apiKey: process.env.PENGUIN_AGENT_KEY,
});

const run = client.stream({ input: "What time is it now?" });
for await (const event of run) {
  if (event.type === "tool_call.done") console.log(`[tool] ${event.name} ${event.arguments}`);
  if (event.type === "text.delta") process.stdout.write(event.text);
}
const first = await run.result();
console.log(`\n[${first.status}] ${first.requests} requests, ${first.usage.total} tokens`);

const second = await client.run({ sessionId: first.sessionId, input: "And in UTC?" });
console.log(second.text);
```

Run it with `node ask.mjs`:

```text
[tool] exec_command {"description":"Read the server's clock","cmd":"date"}
It's 01:47 on October 13, 2026, by the server's clock (CST).
[completed] 2 requests, 6696 tokens
That is 17:47 UTC on Monday, October 12.
```

`client.stream()` returns the run to iterate as events arrive. `run.result()` resolves once it ends. `client.run()` waits for the end and returns only the result. Passing `sessionId` continues the conversation, as `session_id` does for curl.

## Where the conversations go

API conversations stay out of the sidebar. They are archived, listed under **Settings** › **Archived chats** with an **API** mark. Unarchive one to read it in the Web App.

## Limits

- A conversation runs one thing at a time: a run on a busy conversation is refused with `409`. When four conversations of the agent are already running, Web App chats included, a new API run is refused with `429` and `Retry-After: 2`.
- Closing the connection aborts the run. To stop a run and still receive its `run.done`, `POST` to `/sessions/<session_id>/abort` under the Base URL.
- **Allow keyless access** lets requests without a key run the agent. Turn it on only for a server that listens on loopback.
- The server's administrator can turn the whole API off with **Allow the Agent API** under **Settings** › **Server** › **Agent API**.
- `penguin agent api` shows and changes the same settings from a terminal, for example `penguin agent api status --agent-id default_agent`.
