---
name: penguin-sdk
description: Build AI apps on the Penguin Harness SDK — self-contained projects inside the Workspace, model configuration, and the createSession/run streaming loop.
short_description: Build AI apps on the Penguin Harness SDK.
short_description_zh: 基于 Penguin Harness SDK 构建 AI 应用。
version: 1
updated: 2026-07-17T00:00:00Z
---

# Penguin Harness SDK

`@prismshadow/penguin-core` is the TypeScript SDK this agent itself runs on. Use it to build your own AI apps:

- An **Agent** loads its state (prompts, tools, skills) from `<root>/<project_id>/<agent_id>/`. Creating an Agent whose directory is empty initializes it with defaults.
- A **Session** is one conversation of an Agent inside a **Workspace** directory.
- `session.run()` executes one task and streams every step (thinking, text, tool calls) as OmniMessages.

To have an agent perform a task, use the `run_subagent` tool — the SDK is for building applications, not for invoking agents.

## Before you start

If the user's message only invokes this skill (e.g. "use penguin-sdk skill") without a concrete app to build, ask the user what they want to build. Do not start until the requirement is clear.

## Project location

Create the app in the current workspace directory by default (the `CWD` value from your Environment section), as a self-contained project — do not place it under `<project_dir>` or depend on any path outside the project folder. Point the agent data root at a directory inside the project with `createAgent({ root })`, resolved from the source file so it stays relative:

```ts
const agent = await createAgent({ root: path.resolve(import.meta.dirname, "penguin_data") });
```

With every reference relative to the project, the user can move or copy the folder anywhere and it still runs.

## Setup

```bash
npm install @prismshadow/penguin-core
```

If the package is not yet available on your npm registry (it is developed in the PenguinHarness monorepo and may not be published), develop inside a checkout of the PenguinHarness repo instead: add your app as a workspace package under `packages/` and depend on `"@prismshadow/penguin-core": "workspace:*"`, then run `pnpm install && pnpm build` at the repo root. Tell the user which route you took.

A model must be configured for the app's data root. Two ways:

1. The penguin CLI, pointed at the project-local data directory:

```bash
penguin config model add --root <data_dir> --model-id <id> --api-key <key> [--base-url <url>] [--client-type openai] --set-default
```

Generally prefer the OpenAI protocol client (chat completion): `--client-type openai --base-url <endpoint>` works with any OpenAI-compatible endpoint. Use exact model ids — see the agenthub-models skill for the id table.

2. Environment variables as a fallback: without a configured credential the SDK reads the provider's env vars (e.g. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`).

Model config lives in a single hidden file under the data root's project directory: `.project_config.toml` (model list, settings and per-model credentials such as `api_key` inlined in each model entry). It is CLI-only — never read, print or edit it; the CLI above manages it.

## Minimal conversational app

```ts
import path from "node:path";
import readline from "node:readline/promises";
import { createAgent, userText } from "@prismshadow/penguin-core";

const agent = await createAgent({ root: path.resolve(import.meta.dirname, "penguin_data") });
const session = await agent.createSession({ workspaceDir: process.cwd() });

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
for (;;) {
  const line = await rl.question("> ");
  if (!line.trim()) break;
  // One run per user turn; the same Session keeps the conversation context.
  for await (const msg of session.run([userText(line)], {
    approve: async () => "allow", // demo only — a real app should ask its user ("deny" blocks the call)
  })) {
    const p = msg.payload;
    if (p.type === "partial_text" && p.event_type === "delta") process.stdout.write(p.text);
  }
  process.stdout.write("\n");
}
rl.close();
```

Key points:

- An Agent's behavior is edited in its `agent_state/` files (system_config.yaml, AGENTS.md, skills/), not in code.
- `createSession({ workspaceDir, modelId })` — omit `workspaceDir` for a temporary workspace, omit `modelId` for the project default model.
- `session.run(messages, { approve, signal })` is an async generator of OmniMessages; filter the payload types you care about (`partial_text` deltas carry the streamed answer).
- The `approve` callback gates every tool call — auto-allow is for demos; a production app should prompt its user before returning `"allow"`.
- Call `session.run()` again on the same Session for the next user turn — the context carries over.
