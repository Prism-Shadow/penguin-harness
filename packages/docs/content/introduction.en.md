---
title: Introduction
description: What PenguinHarness is, what ships in the box, and where to start.
---

Welcome to the PenguinHarness documentation. PenguinHarness is an open-source agent harness for building, running, evaluating and improving AI agents, built as one TypeScript stack. It deploys fully locally, so everything it stores stays on your machine; it runs on as little as a single CPU, and one unified model gateway reaches 1000+ online and local models.

## Get started

Work through these pages in order:

1. [Quickstart](/quickstart): install PenguinHarness with the desktop app, the CLI, Docker or the SDK, and run your first Task.
2. [Key concepts](/concepts): learn the terms these docs use, such as Project, Session, Task and Workspace.
3. [Conversations](/chat): work with an agent in a conversation and follow what it does.
4. [Agents](/agents): create agents and configure their prompts, Skills, memory and tools.
5. [Evaluation Center](/evaluation-center): measure an agent against a Benchmark and improve it.

## What ships in the box

PenguinHarness is made of these components. They share one data root and one message protocol, so you can mix them freely.

| Component | Package | Description |
| --- | --- | --- |
| SDK | `@prismshadow/penguin-core` | The core engine: the ReAct loop, the [OmniMessage protocol](/omni-message), the LLM and Environment [interface contracts](/interfaces), Agent State and Trace. |
| CLI | `@prismshadow/penguin-cli` | The `penguin` command: an interactive REPL, one-shot Task runs, and model and Vault configuration. |
| Server | `@prismshadow/penguin-server` | The Web backend: the HTTP [API and SSE streaming](/server-api), multi-user auth, Project authorization and usage statistics. |
| Web App | `@prismshadow/penguin-web` | The browser UI: multi-session chat, agent management, the plugin library, model configuration, Trace observability and the Evaluation Center. |
| Desktop app | `@prismshadow/penguin-desktop` | The Web App as a standalone application for macOS, Windows and Linux. It embeds the server and installs the `penguin` command. |

## The three pillars

PenguinHarness is summed up in one line, **Efficient Self-Improving Harness for Everyone**, and organized around three concepts: the message protocol, the SDK and the skill library. Each concept carries one pillar:

| Pillar | Meaning |
| --- | --- |
| **Simplest Is the Best** | A deliberately minimal toolset over clean low-level interfaces: fewer tool calls, fewer Tokens, and complex tasks done efficiently. |
| **Harness for Building Agents** | With the PenguinHarness SDK, an agent builds complete agent applications for you, autonomously and from scratch. |
| **Harness for Recursive Self-Improvement** | With PenguinHarness Skills, an agent evaluates and optimizes itself, improving recursively over time. |

## Design tenets

These principles run through every component, and the design pages keep coming back to them:

- **A minimal toolset**: dedicated file tools (`read_file` / `edit_file` / `write_file`) handle precise reading and editing, and the shell (`exec_command`) is the general-purpose fallback for everything else. See [Tools & Approval](/tools).
- **Agents are editable data**: prompts, Skills and config are editable files on disk, not hardcoded constants. What you can see, an agent can improve. See the [Configuration Reference](/configuration).
- **Everything is observable**: every request, tool call and approval decision is appended to the [Trace](/sessions-and-traces), and a Session restores fully from it.
- **Errors converge into messages**: model and tool failures never throw. They become messages the model can react to. See [The Agent Loop](/agent-loop).
- **Streaming first**: text streams token by token, and tool calls and results appear live.
- **Models and agents are decoupled**: an agent never binds to a model; you pick one per Session. See [Models & Providers](/models).

## A note on naming

The unified message protocol is called **OmniMessage** in technical writing, and marketing materials also call it Penguin Message. This documentation uses OmniMessage throughout.

## Learn how it works

To see how the pieces fit together, start the design pages at the [Architecture](/architecture) overview.
