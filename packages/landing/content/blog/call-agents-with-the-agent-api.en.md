---
title: "Connect agents to any external app through one unified API"
date: 2026-10-13
category: practice
excerpt: "Every agent in PenguinHarness answers on the same API. Turn it on, create a key, and any app can run the agent from curl or from TypeScript with the @prismshadow/amsp client: the run streams back as AMSP records, and the Session id it returns continues the conversation."
---

The Agent API connects your agents to any app outside PenguinHarness over HTTP, and it is the same API for every agent: the same endpoints, the same AMSP records and the same client, whichever agent you call. The app sends its input, reads a stream of AMSP records as the run happens, and continues the conversation by its Session id. Runs use the Project's models and credentials, and each one is recorded like any other conversation.

This tutorial exposes the default agent, asks it for the time from curl, then does the same from Node with the `@prismshadow/amsp` client.

## Prerequisites

- PenguinHarness 0.2.17 or later with a model configured on the **Models** page.
- The owner role in the Project. Only the owner turns an agent's API on and manages its keys.
- curl, or Node 24 for the client.

## Step 1: Turn on the agent's API

1. Open **Agents**, select the agent, and select the **API** tab.
2. Turn on **Enable API access**.
3. Leave **Approval mode** at **Approve everything**, so tool calls run without waiting for an answer. With **Approve read-only** or **Ask every time**, a call that needs approval waits for the program to answer it.
4. Under **Keys**, select **New key**, type a **Key name**, and select **Create**. The key is shown once: copy it.

![The API tab: Enable API access on, the approval mode, the Base URL and Agent ID under Connection, and one key](/blog-assets/agent-api-tab-en.png)

**Connection** holds the other two things a program needs: the **Base URL**, which is your server's address followed by `/api/amsp/v1`, and the **Agent ID**, `<projectId>/<agentId>`. Put the key and the Base URL in your shell:

```bash
export PENGUIN_AGENT_KEY='penguin_…'                       # the key you copied
export PENGUIN_AGENT_URL=http://localhost:7364/api/amsp/v1  # your Base URL
```

Keep the address `localhost`: a server bound to loopback answers API requests on `127.0.0.1` with `401`.

## Step 2: Try it in the tab

At the end of the tab, **Try it** sends one real run through the same route a program calls, with your sign-in standing in for the key. Select **Run** and the output appears: one numbered row per record in **Rendered**, and every line exactly as received in **Raw**. The strip under them gives the run's status, with Requests and tokens.

![Try it after one completed run of "What time is it now?": the rows for the run's records in the Rendered view, and the strip with Status completed, Requests 2, Tokens 96 / 6696](/blog-assets/penguinharness-0-2-17-agent-api-en.png)

## Step 3: Run the agent with curl

```bash
curl -N "$PENGUIN_AGENT_URL/agents/default_project/default_agent/runs" \
  -H "Authorization: Bearer $PENGUIN_AGENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"input":"What time is it now?"}'
```

The answer is the run itself. A `ping` opens the stream; every record is one `data:` line followed by its `id:` line, and on a new conversation the first record is its `session_meta`, whose `session_id` names the conversation. Then come `task_begin`, the input as a user `text`, the run's records, `task_end`, and `data: [DONE]`. This is the stream that request returned with a scripted test model in place of a real one, shortened:

```text
event: ping
data: {}

data: {"timestamp":"2026-10-26T02:30:01.153Z","type":"session_meta","payload":{"session_id":"session-2026-10-26-10-30-01-6458d204","provider":"deepseek","model_id":"deepseek-v4-pro",…}}
id: 2f9bdf98-3

data: {"timestamp":"2026-10-26T02:30:01.172Z","type":"event_msg","payload":{"type":"task_begin"}}
id: 2f9bdf98-4

…

data: {"timestamp":"2026-10-26T02:30:02.227Z","type":"model_msg","payload":{"type":"tool_call","role":"assistant","name":"exec_command","arguments":"{\"description\":\"Read the server's clock\",\"cmd\":\"date\"}","tool_call_id":"call_f0c5c2018e40adb99c5c9ac8"}}
id: 2f9bdf98-14

…

data: {"timestamp":"2026-10-26T02:30:02.327Z","type":"model_msg","payload":{"type":"tool_call_output","role":"user","output":"Mon Oct 26 10:30:02 CST 2026\n","tool_call_id":"call_f0c5c2018e40adb99c5c9ac8","status":"completed"}}
id: 2f9bdf98-21

…

data: {"timestamp":"2026-10-26T02:30:03.244Z","type":"model_msg","payload":{"type":"partial_text","role":"assistant","event_type":"delta","text":"It's 10:30 on Oc"}}
id: 2f9bdf98-24

…

data: {"timestamp":"2026-10-26T02:30:03.426Z","type":"model_msg","payload":{"type":"text","role":"assistant","text":"It's 10:30 on October 26, 2026, by the server's clock (CST)."}}
id: 2f9bdf98-29

…

data: {"timestamp":"2026-10-26T02:30:03.431Z","type":"event_msg","payload":{"type":"request_end","status":"completed"}}
id: 2f9bdf98-31

data: {"timestamp":"2026-10-26T02:30:03.467Z","type":"event_msg","payload":{"type":"task_end"}}
id: 2f9bdf98-32

data: [DONE]
```

A message streams as `partial_*` fragments, then arrives once as its complete record, such as `tool_call`, `tool_call_output` or `text`. Each model Request sits between `request_begin` and `request_end`, and `request_end.status` says how it ended (here `completed`); how the whole run went is read from its records, as [the docs](https://penguin.ooo/docs/amsp#a-runs-result) explain. For code written against the earlier v1 events, [the docs](https://penguin.ooo/docs/amsp#from-the-earlier-v1-events) map every one to its record.

`-N` stops curl from buffering, so events print as they arrive. To continue the conversation, send the `session_id` from the new conversation's `session_meta`, the first record, with the next input:

```bash
curl -N "$PENGUIN_AGENT_URL/agents/default_project/default_agent/runs" \
  -H "Authorization: Bearer $PENGUIN_AGENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"session_id":"session-2026-10-26-10-30-01-6458d204","input":"And in UTC?"}'
```

```text
…

data: {"timestamp":"2026-10-26T02:30:04.539Z","type":"model_msg","payload":{"type":"text","role":"assistant","text":"That is 02:30 UTC on Monday, October 26."}}
id: 2f9bdf98-43

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
import { AgentClient, isModelMessage } from "@prismshadow/amsp";

const client = new AgentClient({
  baseUrl: process.env.PENGUIN_AGENT_URL,
  agent: "default_project/default_agent",
  apiKey: process.env.PENGUIN_AGENT_KEY,
});

const run = client.stream({ input: "What time is it now?" });
for await (const record of run) {
  // Records without `origin` are the main conversation's; a subagent's carry one.
  if (record.origin || !isModelMessage(record)) continue;
  const p = record.payload;
  if (p.type === "tool_call") console.log(`[tool] ${p.name} ${p.arguments}`);
  if (p.type === "partial_text") process.stdout.write(p.text);
}
const first = await run.result();
console.log(`\n[${first.status}] ${first.requests} requests, ${first.usage.total} tokens`);

const second = await client.run({ sessionId: first.sessionId, input: "And in UTC?" });
console.log(second.text);
```

Run it with `node ask.mjs`:

```text
[tool] exec_command {"description":"Read the server's clock","cmd":"date"}
It's 10:30 on October 26, 2026, by the server's clock (CST).
[completed] 2 requests, 6696 tokens
That is 02:30 UTC on Monday, October 26.
```

`client.stream()` returns the run to iterate as records arrive. The loop skips a subagent's records and event records, using `origin` and `isModelMessage`, and prints the complete `tool_call` and the `partial_text` fragments as they come. `run.result()` resolves once it ends. `client.run()` waits for the end and returns only the result. Passing `sessionId` continues the conversation, as `session_id` does for curl.

## Where the conversations go

API conversations stay out of the sidebar. They are archived, listed under **Settings** › **Archived chats** with an **API** mark. Unarchive one to read it in the Web App.

## Limits

- A conversation runs one thing at a time: a run on a busy conversation is refused with `409`. How many conversations may run at once is set on the API tab under **Run settings** › **Maximum concurrent runs** (default 4). Running conversations, Web App chats included, count toward it; at the limit a new API run is refused with `429` and `Retry-After: 2`.
- Closing the connection aborts the run. To stop a run and still receive its records to the end, `POST` to `/sessions/<session_id>/abort` under the Base URL: the records end with `abort` and `task_end`, and the stream ends with `data: [DONE]`.
- **Allow keyless access** lets requests without a key run the agent. Turn it on only for a server that listens on loopback.
- The server's administrator can turn the whole API off with **Allow the Agent API** under **Settings** › **Server** › **Agent API**.
- `penguin agent api` shows and changes the same settings from a terminal, for example `penguin agent api status --agent-id default_agent`.
