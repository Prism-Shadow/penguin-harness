---
title: Architecture
description: How the SDK, Server, CLI and Web App divide responsibilities, and how the three-interface boundary and OmniMessage organize the system.
---

PenguinHarness is a pnpm monorepo. Its center is the execution engine in `@prismshadow/penguin-core`. The Server ships with the product as the Human implementation of that engine: it runs every Task. SDK embedders can also drive the engine directly.

The Web App and the CLI are clients of the Server over HTTP and SSE, and the desktop app wraps the Server and the Web App in one window. This page covers the layers, the engine's three-interface boundary, the [data flow of one Task](#data-flow-of-one-task), where each responsibility lives, and the source layout.

## Layers

The stack, top to bottom:

```text
┌─────────────┐  ┌─────────────────────────────┐
│   CLI       │  │  Web App (React SPA)        │
│  (penguin)  │  │                             │
└──────┬──────┘  └──────────────┬──────────────┘
       │                        │   HTTP · OmniMessage over SSE
┌──────┴────────────────────────┴──────────────┐
│  Server (Hono + SQLite)                      │
└──────────────────────┬───────────────────────┘
                       │ session.run(...)   ← Human boundary
┌──────────────────────┴───────────────────────┐
│  core: context_engine (ReAct loop)           │
│    ├── LLMInterface ──→ AgentHub ──→ models  │
│    ├── EnvironmentInterface ──→ builtin tools│
│    ├── Agent State (editable files)          │
│    └── Trace (append-only JSONL)             │
└──────────────────────────────────────────────┘
```

The CLI and the Web App talk to the Server over HTTP and SSE. Among the shipped apps, only the Server calls `session.run`.

| Package | Role |
| --- | --- |
| `packages/core` | SDK and engine: `context_engine`, OmniMessage, the LLM and Environment interfaces, hooks, state and Trace |
| `packages/server` | The Human implementation: runs Tasks through core, takes input and approvals over HTTP, streams output over SSE |
| `packages/cli` | Terminal client of the Server: REPL and one-shot runs over HTTP and SSE. It starts a local Server when none is running. Only `penguin config` reads and writes configuration files directly through the SDK |
| `packages/web` | Rendering SPA: renders the OmniMessage stream and contains no engine logic |
| `packages/desktop` | Desktop app: an Electron shell that runs the Server as a `utilityProcess` and opens its window on the local HTTP address |
| `packages/hmr` | The hot-update mechanism: the version store, the atomic commit, the resource registry, and park → boot → swap |
| `plugins/*` | The built-in plugin library, one package per plugin: Skills (`SKILL.md` directories) and Session hooks (script packages), loaded by core |

## The three-interface boundary

The `context_engine` is the heart of the system. It does exactly two things: it maintains the linear message history, and it orchestrates the event flow between three interfaces. It speaks only [OmniMessage](/omni-message) and performs no protocol conversion.

- **Human**: the user-side boundary. It is deliberately not an interface class: the SDK's single entry point, `session.run(newMessages, { approve, signal })`, *is* the Human boundary. Input is a list of new OmniMessages plus an approval callback; output is a stream of OmniMessages. The Server is the shipped implementation. The CLI and the Web App reach it over HTTP and SSE, and SDK embedders call `session.run` themselves.
- **LLM**: the model-side interface, `LLMInterface`. It translates OmniMessage into requests against the AgentHub model gateway, and streamed events back into OmniMessage. All provider protocol adaptation happens inside AgentHub, so core never imports a vendor SDK.
- **Environment**: the tool-execution interface, `EnvironmentInterface`. It runs approved tool calls and streams the results back.

The kernel contains no provider, tool or UI specifics, so each side swaps by configuration without touching core: a local shell today, another sandbox tomorrow; the CLI, the Web App or a programmatic caller. See [Core Interfaces](/interfaces) for the signatures.

## Data flow of one Task

1. The Human hands a Prompt (a list of OmniMessages) to `session.run`.
2. The engine issues a Request. The `LLMInterface` streams `partial_*` fragments and complete messages.
3. Every complete `tool_call` triggers one `approve` decision. Approved calls run concurrently in the Environment.
4. Tool outputs are re-fed in their original order as the next Request's input.
5. The Task ends when a turn produces no `tool_call`: that turn is the final answer.

Every message and event flows to two destinations at once: it streams live to the Human, and it is appended to the [Trace](/sessions-and-traces). Loop details such as interruption, reconnect and compaction are on [The Agent Loop](/agent-loop).

## Division of responsibilities

To place a design in a layer, ask where its **source of truth** lives. One rule decides: what is editable or recorded lives in files; what makes messages flow lives in the SDK; what needs a resident process and multiple users lives in the Server; the rest is rendering.

| Layer | Owns | Does not own |
| --- | --- | --- |
| SDK (`core`) | Protocol and execution: everything that makes messages flow | persisted user state, multi-user, any rendering |
| Server | The resident process and the multi-user runtime | engine logic, fully delegated to the SDK |
| File layer (`~/.penguin/data`) | Everything editable and everything recorded | any computation |
| CLI / Web | Rendering and interaction | business state |

Item by item, each design maps to an owner and to the file or module that carries it:

| Design | Owner | Carried by |
| --- | --- | --- |
| The OmniMessage protocol, message parsing and partial aggregation | SDK | `core/src/omnimessage/` — see [The OmniMessage Protocol](/omni-message) |
| The ReAct loop, carry-over, reconnect, compaction | SDK | `core/src/engine/context-engine.ts` — see [The Agent Loop](/agent-loop) |
| The approval mechanism (one decision per `tool_call`) | SDK | `ApproveFn` (`core/src/interfaces/shared.ts`); the concrete mode is injected by the Server or an SDK host |
| Tool execution and centralized close-out | SDK | `core/src/environment/` — see [Tools & Approval](/tools) |
| Model access (provider protocol adaptation) | SDK → AgentHub | `core/src/llm/` + `@prismshadow/agenthub` — see [Models & Providers](/models) |
| Trace writing and Session-recovery logic | SDK | `core/src/trace/` (the records themselves live in the file layer) |
| Subagent spawning and message forwarding | SDK | the `run_subagent` tool + the injected `SubagentRunner` |
| Multi-user auth and Project authorization | Server | `server/src/auth/`, `server/src/services/project-service.ts` |
| Session indexing, per-Session mutex, SSE forwarding | Server | `server/src/runtime/` — see [Server API](/server-api) |
| Scheduled task execution | Server | `server/src/runtime/scheduler.ts`; the task definitions live in the file layer at `agent_state/schedule/*.toml` |
| Approval-mode persistence and manual decisions | Server | `server/src/runtime/approvals.ts` + SQLite |
| Usage persistence and cost statistics | Server | `server/src/runtime/usage-recorder.ts`, `services/usage-service.ts` |
| Agent behavior definition (prompts, runtime parameters) | File layer | `agent_state/system_config.yaml`, `AGENTS.md` — see the [Configuration Reference](/configuration) |
| Skills, hooks | File layer | `agent_state/skills/<name>/SKILL.md`, `agent_state/hooks/<name>/hooks.json` — see [Skills & Plugins](/skills) |
| Secrets | File layer | Vault: `agent_state/.vault.toml`; model credentials: `.project_config.toml` (both 0600) |
| The model table and the default model | File layer | `<project>/.project_config.toml` |
| Run history (the sole source of truth for recovery) | File layer | `traces/<date>/<session>_<index>.jsonl` — see [Sessions & Traces](/sessions-and-traces) |
| Benchmark cases and scores | File layer | `<project>/benchmarks/<id>/` — see [Self-Improvement](/self-improvement) |
| Snapshots | File layer | `snapshots/v<version>.tar.gz`; the export/import service lives in the Server |
| Streaming rendering, approval UI, charts | CLI / Web | `cli/src`, `web/src` (pure rendering, no engine logic) |

> [!NOTE]
> The Server's SQLite stores only indexes and aggregates. It never competes with the file layer as a source of truth.

## The state layer

Below the engine sits a purely file-based state layer. Its root is `~/.penguin/data` (override it with `PENGUIN_HOME`), organized as `<project>/agents/<agent>/`:

| Component | Location | Contents |
| --- | --- | --- |
| Agent State | `agent_state/` | `system_config.yaml`, `AGENTS.md`, Skills, Vault. An agent's entire behavior is editable files. |
| Project config | `.project_config.toml` | The model table and credentials. Model identity is always the `(provider, model_id)` pair. |
| Trace | `traces/` | Append-only JSONL: the single source of truth for Session recovery. |

The Server keeps an additional SQLite index (users, authorization, usage stats) but never duplicates the file layer's facts. The CLI, the SDK and the Web App share one data directory and can be mixed freely.

## Source layout

Each package is organized into single-purpose files, split by layer. Every file's header comment is its design note.

```text
packages/
├── core/src
│   ├── agent.ts / session.ts       # the createAgent composition layer and Session (run / compact / generateTitle)
│   ├── engine/context-engine.ts    # ReAct loop orchestration: turn lifecycle, approvals, carry-over, reconnect, compaction
│   ├── omnimessage/                # types.ts protocol types · builders.ts constructors · aggregate.ts partial aggregation · markers/
│   ├── interfaces/                 # llm.ts · environment.ts · shared.ts (ApproveFn and the vocabulary both sides share)
│   ├── llm/                        # generative-model.ts AgentHub adapter · tool-call-ids.ts id uniqueness · context-limits.ts
│   ├── environment/                # environment.ts execution close-out · tools/ registry, 7 builtin tools, background sessions · mcp/
│   ├── hooks/                      # the stop / pre_tool_use / user_prompt hook points and the hook-script runner
│   ├── plugins/                    # the built-in plugin library and its loader
│   ├── plugin/ · kernel/           # the plugin contract a server plugin compiles against · the hot-update module kernel
│   ├── state/                      # paths · default-config · project-config · model-catalog · memory
│   │                               # agent-state (Skill install, prompt assembly) · agent-vault · builtin-agents
│   ├── trace/                      # writer.ts append-only JSONL · resume.ts replay-based recovery
│   └── internal/                   # shared helpers: dates, Session support, merge queue, session-title.ts (one-shot title generation, never in Trace)
├── server/src                      # index.ts boot sequence · app assembly · db (node:sqlite) · auth · http/routes · runtime · services · hmr · plugin · terminal
├── cli/src                         # commander entry · commands/ (run / chat / input / logs / ls / agent / project / schedule / config / serve …) · server client and approval prompts
├── web/src                         # api client · state · lib/omni stream rendering · components · feature pages (layout below)
├── desktop/                        # the Electron shell
├── hmr/                            # the hot-update mechanism
├── landing/                        # the product landing page (with the blog)
└── docs/                           # this documentation site
```

### Web App source

```text
packages/web/src
├── api/          # fetch wrapper · one function per API (DTOs type-only from @prismshadow/penguin-server/api) · SSE wrapper
├── state/        # auth / project / sessions / company / theme / locale contexts
├── lib/omni/     # OmniMessage stream → view-model reducer; connect-first + dedup stream controller
├── components/   # ui primitives (modal / drawer / select …) and the app layout
├── pages/        # the login pages
└── features/     # chat / agents / skills / plugins / models / usage / traces / benchmark / schedules / company / settings / admin … pages
```

The Server's routes and delivery guarantees are detailed on [Server API](/server-api), and how the Server process assembles its subsystems on [Server Boot and Subsystems](/server-boot).

## Key design decisions

### One protocol, three jobs

OmniMessage is at once the SDK's external interface, the Trace's on-disk format and the engine's internal currency. What streams, what is stored and what the model sees are the same thing.

### Errors converge into messages

The LLM and the Environment never throw into the engine. Their results carry a four-value `stop_reason`, and the concrete cause rides on `error_code` and `error_message`:

| `stop_reason` | Meaning and engine behavior |
| --- | --- |
| `completed` | Finished normally; the loop continues or the Task ends |
| `retryable` | An LLM failure worth retrying: the engine reconnects within the run, up to 5 consecutive fruitless retries, on an exponential backoff with a ceiling |
| `fatal` | A definitive failure, such as a rejected credential: the run stops at once, because no retry can make it work |
| `aborted` | A user interruption |

### A thin model layer

Core defines only `LLMInterface`. Provider adaptation lives entirely in AgentHub (`@prismshadow/agenthub`), which is what makes any OpenAI-compatible endpoint reachable. See [Models & Providers](/models).

Source entry points: `packages/core/src/engine/context-engine.ts`, `packages/core/src/interfaces/`.
