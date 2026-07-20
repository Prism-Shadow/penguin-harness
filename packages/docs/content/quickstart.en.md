---
title: Quickstart
description: Install PenguinHarness, configure a model, and run your first Task.
---

## Install

One-liner for Linux / macOS:

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
```

For other options (npm, from source), see [Installation](/installation).

## Configure a model

PenguinHarness ships with no built-in model credentials, so configure a model first. Use the Models page in the Web UI, or the CLI:

```bash
penguin config model add --model-id deepseek-v4-pro --api-key sk-... --set-default
```

- When `--provider` is omitted, the Provider is inferred from the built-in catalog.
- The API key can also come from environment variables: when a model entry has no inline api_key, AgentHub (the LLM gateway library) reads variables such as `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and `GEMINI_API_KEY`. A `.env` file in the working directory is loaded automatically.

## Start the Web App

```bash
penguin web
```

The service runs at http://127.0.0.1:7364 and opens your browser (`--no-open` to skip). First login is `admin` / `admin123` — change it right away. `penguin server` starts the same process headless.

## One-shot run

```bash
penguin run -m "Create hello.txt containing Hello, Penguin"
```

The Workspace defaults to the current directory; pass `--workspace /path` to change it. The target directory must already exist.

## Interactive chat

```bash
penguin chat
```

- Each input line starts a Task.
- `/compact` compacts the context; `/exit` or `/quit` quits; Ctrl-C interrupts the running Task.
- On exit it prints a `penguin chat --resume <sessionId>` hint for resuming this Session; `--resume` without an id resumes the Agent's latest Session.

## SDK hello

After installing `@prismshadow/penguin-core`:

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

## Next steps

- [Web App Guide](/web-app): use PenguinHarness from the browser.
- [CLI Reference](/cli): the full list of commands and options.
- [Architecture Overview](/architecture): how the pieces fit together.
