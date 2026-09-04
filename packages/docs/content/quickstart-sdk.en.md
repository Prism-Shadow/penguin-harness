---
title: SDK
description: Create Agents and Sessions from your own TypeScript program with @prismshadow/penguin-core.
---

`@prismshadow/penguin-core` is the same engine the CLI and the Server run inside, and it embeds directly into your own program.

## Install

Requires Node.js >= 24:

```bash
npm install @prismshadow/penguin-core
```

## Configure a model

The SDK reads the same data root as the desktop app and the CLI, `~/.penguin/data`, so a model configured in the [desktop app](/quickstart-desktop) or the [CLI](/quickstart-cli) is immediately usable — there is nothing to configure twice.

If this machine has no model configured yet, the shortest path is to install the CLI and do it once:

```bash
npm install -g @prismshadow/penguin-cli
penguin config model add --provider deepseek --model-id deepseek-v4-flash-vision-exp --api-key sk-... --set-default
```

You can also keep credentials off disk entirely: when a model entry has no inline api_key, AgentHub (the LLM gateway library) reads environment variables such as `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and `GEMINI_API_KEY`. A `.env` file in the working directory is loaded automatically.

## Your first program

```ts
import { createAgent, isCompleteModelMessage, userText } from "@prismshadow/penguin-core";

const agent = await createAgent({ agentId: "default_agent" });
const session = await agent.createSession({ workspaceDir: process.cwd() });

for await (const output of session.run([userText("Create hello.txt containing hi")], {
  approve: async () => "allow",
})) {
  if (isCompleteModelMessage(output) && output.payload.type === "text") {
    console.log(output.payload.text);
  }
}
```

- `createAgent` loads an Agent's configuration by id (prompts, tools, runtime parameters); `default_agent` is the one seeded when the data root is initialized.
- `session.run()` returns an async iterator yielding OmniMessages one by one — the guard above picks out complete model text messages, while tool calls, thinking blocks and the rest arrive on the same stream.
- `approve` is the approval callback; returning `"allow"` permits everything. How the four approval modes map onto tools is described in [Tools & Approval](/tools).

## Next steps

- [Core Interfaces](/interfaces): the contracts behind `createAgent`, `Session`, LLM and Environment.
- [The OmniMessage Protocol](/omni-message): the shape of what `session.run()` yields.
- [The Agent Loop](/agent-loop): what happens inside a single Task.
- [Sessions & Traces](/sessions-and-traces): how conversations and execution records are stored.
