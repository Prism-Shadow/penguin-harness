# @prismshadow/amsp

The client of a PenguinHarness agent's API, and the types of AMSP (Agent Message Stream Protocol), the event stream that API serves. No runtime dependencies; runs in Node 24 and in current browsers on `fetch`, `ReadableStream`, `TextDecoder` and `AbortController`.

A Project owner turns an agent's API on in the PenguinHarness Web App (the agent's **API** tab) and mints a key there. A program then runs the agent, reads the run as it happens, and continues the conversation by its Session id:

```ts
import { AgentClient } from "@prismshadow/amsp";

const client = new AgentClient({
  baseUrl: "http://127.0.0.1:7364/api/amsp/v1",
  agent: "demo/coder", // <projectId>/<agentId>
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
  onApproval: () => "allow", // without a callback, approval requests are denied
});
console.log(second.text, second.usage.total);
```

- `run()` starts the run and returns it: iterate it once for the events, await `session` for the Session id, `result()` for the outcome, and call `abort()` to have the server abort it. `ask()` returns the result alone.
- `result()` resolves for every run that reached `run.done`, whatever its `status`. A refusal before the stream rejects with `AmspHttpError` (`status`, `code`, `message`); a stream that ends or breaks before `run.done` rejects with `AmspStreamError`; aborting the `signal` rejects with its reason.
- `onApproval` answers each `approval.requested`, and the client posts the answer; `parseArguments` reads a tool call's JSON arguments.
- `agent()`, `session(id)`, `abort(id)` and `approve(id, toolCallId, decision)` call the API's other routes; `readSse` is the SSE reader, for a program that reads a run's body itself.
- Every AMSP event type is exported (`AmspEvent`, `RunDone`, `ToolCallDone`, …). Events of a type the client does not know are passed through.

## Documentation

- [Agent API](https://penguin.ooo/docs/agent-api): turning an agent's API on, keys, approval modes, routes, errors, the client in Node and browsers
- [AMSP](https://penguin.ooo/docs/amsp): the protocol, event by event

## Development

```bash
pnpm --filter @prismshadow/amsp build       # tsup → dist/ (exports point at dist)
pnpm --filter @prismshadow/amsp typecheck
pnpm --filter @prismshadow/amsp test
```

Part of [PenguinHarness](https://github.com/Prism-Shadow/penguin-harness) · Apache-2.0
