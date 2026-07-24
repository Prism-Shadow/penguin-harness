---
title: Introduction
description: What PenguinHarness is, what ships in the box, and the design tenets behind it.
---

PenguinHarness is an open-source AI Agent harness — a complete TypeScript stack built for constructing and evolving agents. It deploys fully locally (your data never leaves the machine), runs on as little as a single CPU, and reaches 1000+ online and local models through one unified model gateway.

In one line: **Efficient Self-Improving Harness for Everyone.**

## The three pillars

PenguinHarness is organized around three radiating concepts — the message protocol, the SDK, and the skill library — each carrying one pillar:

| Pillar | Meaning |
| --- | --- |
| **Simplest Is the Best** | A deliberately minimal toolset over clean low-level interfaces: fewer tool calls, fewer Tokens, complex tasks done efficiently. |
| **Harness for Building Agents** | With the PenguinHarness SDK, an Agent builds complete Agent applications for you — autonomously, from scratch. |
| **Harness for Recursive Self-Improvement** | With PenguinHarness Skills, an Agent evaluates and optimizes itself, improving recursively over time. |

## What ships in the box

One install gives you four layers that share a single data directory and a single message protocol:

| Component | Package | Description |
| --- | --- | --- |
| SDK | `@prismshadow/penguin-core` | The core engine: ReAct loop, the [OmniMessage protocol](/omni-message), the LLM and Environment [interface contracts](/interfaces), Agent State and Trace. |
| CLI | `@prismshadow/penguin-cli` | The `penguin` command: interactive REPL, one-shot task runs, model and Vault configuration. |
| Server | `@prismshadow/penguin-server` | The Web backend: HTTP [API and SSE streaming](/server-api), multi-user auth, Project authorization, usage statistics. |
| Web App | `@prismshadow/penguin-web` | The browser UI: multi-session chat, Agent management, skill library, model configuration, Trace observability and the evaluation center. |

## Design tenets

These principles run through every component; the design pages keep coming back to them:

- **A minimal toolset**: dedicated file tools (`read_file` / `edit_file` / `write_file`) for precise reading and editing, with the shell (`run_command`) as the general-purpose fallback for everything else. See [Tools & Approval](/tools).
- **Agents are editable data**: prompts, Skills and config are editable files on disk, not hardcoded constants — what you can see, an Agent can improve. See the [Configuration Reference](/configuration).
- **Everything observable**: every request, tool call and approval decision is appended to the [Trace](/sessions-and-traces); a Session restores fully from it.
- **Errors converge into messages**: model and tool failures never throw — they become messages the model can react to. See [The Agent Loop](/agent-loop).
- **Streaming first**: text streams token by token; tool calls and results appear live.
- **Model ↔ Agent decoupling**: an Agent never binds to a model; you pick one per Session. See [Models & Providers](/models).

## A note on naming

The unified message protocol is called **OmniMessage** in technical writing (marketing materials also call it Penguin Message). This documentation uses OmniMessage throughout.

## Next steps

- [Install](/installation) PenguinHarness, then run your first Task with the [Quickstart](/quickstart).
- Start the design docs at the [Architecture](/architecture) overview to see how the pieces fit together.
