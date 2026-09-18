---
title: SDK
description: Create agents and Sessions from your own TypeScript program with @prismshadow/penguin-core.
---

`@prismshadow/penguin-core` is the same engine the CLI and the server run inside, and it embeds directly into your own program. On this page you install the SDK, make a model available to it, and run a first program that creates an agent, starts a Session and prints the model's replies.

## Before you begin

- Node.js >= 24.
- An API key for one model provider, unless a model is already configured on this machine.

## Install the SDK

In your project directory, install the package:

```bash
npm install @prismshadow/penguin-core
```

## Configure a model

The SDK reads the same data root as the desktop app and the CLI, `~/.penguin/data`. A model configured in the [desktop app](/quickstart-desktop) or the [CLI](/quickstart-cli) is immediately usable, so there is nothing to configure twice.

If this machine has no model configured yet, the shortest path is to install the CLI and configure one there:

```bash
npm install -g @prismshadow/penguin-cli
penguin config model add --provider deepseek --model-id deepseek-flash --api-key sk-... --set-default
```

Replace `sk-...` with your API key. The CLI writes the model to the data root, and the SDK can use it right away.

You can also keep credentials off disk entirely. When a model entry has no inline `api_key`, AgentHub (the LLM gateway library) reads environment variables such as `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and `GEMINI_API_KEY`. A `.env` file in the working directory is loaded automatically.

## Run your first program

Save this program in your project and run it:

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

The program asks the agent to create `hello.txt`, using the current directory as the Session's Workspace, and prints each complete text reply from the model.

### How the program works

- `createAgent` loads an agent's configuration by id: its prompts, tools and runtime parameters. `default_agent` is the agent seeded when the data root is initialized.
- `session.run()` returns an async iterator that yields OmniMessages one by one. The guard in the loop picks out complete model text messages; tool calls, thinking blocks and everything else arrive on the same stream.
- `approve` is the approval callback, and returning `"allow"` permits everything. [Tools & Approval](/tools) describes how the four approval modes map onto tools.

## Next steps

- [Core Interfaces](/interfaces): the contracts behind `createAgent`, `Session`, LLM and Environment.
- [The OmniMessage Protocol](/omni-message): the shape of what `session.run()` yields.
- [The Agent Loop](/agent-loop): what happens inside a single Task.
- [Sessions & Traces](/sessions-and-traces): how conversations and execution records are stored.
