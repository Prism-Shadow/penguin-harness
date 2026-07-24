---
title: Architecture
description: How the three-interface boundary, the context_engine and OmniMessage organize the SDK, CLI, Server and Web App into one system.
---

PenguinHarness is a pnpm monorepo whose center is the execution engine in `@prismshadow/penguin-core`; the CLI, the Server and the Web App are just different "Human implementations" of that same engine.

## Layers

```text
┌─────────────┐  ┌─────────────────────────────┐
│   CLI       │  │  Web App (React SPA)        │
│  (penguin)  │  │    ↑ OmniMessage over SSE   │
│             │  │  Server (Hono + SQLite)     │
└──────┬──────┘  └──────────────┬──────────────┘
       │      session.run(...)  │        ← Human boundary
┌──────┴────────────────────────┴──────────────┐
│  core: context_engine (ReAct loop)           │
│    ├── LLMInterface ──→ AgentHub ──→ models  │
│    ├── EnvironmentInterface ──→ builtin tools│
│    ├── Agent State (editable files)          │
│    └── Trace (append-only JSONL)             │
└──────────────────────────────────────────────┘
```

| Package | Role |
| --- | --- |
| `packages/core` | SDK and engine: context_engine, OmniMessage, LLM/Environment interfaces, State and Trace |
| `packages/cli` | Terminal Human implementation: REPL and one-shot runs, embeds core in-process |
| `packages/server` | Web Human implementation: HTTP for input and approvals, SSE for the output stream |
| `packages/web` | Rendering SPA: streams by the OmniMessage protocol, contains no engine logic |
| `packages/skills` | The built-in skill library (a set of `SKILL.md` files) |

## Division of responsibilities

To place a design in a layer, ask where its **source of truth** lives. The four layers split as:

| Layer | Owns | Does not own |
| --- | --- | --- |
| SDK (`core`) | Protocol and execution — everything that makes messages flow | persisted user state, multi-user, any rendering |
| Server | The resident process and the multi-user runtime | engine logic (fully delegated to the SDK) |
| File layer (`~/.penguin/data`) | Everything editable and everything recorded | any computation |
| CLI / Web | Rendering and interaction | business state |

Item by item (design → owner → carrying file or module):

| Design | Owner | Carried by |
| --- | --- | --- |
| The OmniMessage protocol, message parsing and partial aggregation | SDK | `core/src/omnimessage/` — see [The OmniMessage Protocol](/omni-message) |
| The ReAct loop, carry-over, reconnect, compaction | SDK | `core/src/engine/context-engine.ts` — see [The Agent Loop](/agent-loop) |
| The approval mechanism (one decision per tool_call) | SDK | `ApproveFn` (`core/src/interfaces.ts`); the concrete mode is injected by CLI/Server |
| Tool execution and centralized close-out | SDK | `core/src/environment/` — see [Tools & Approval](/tools) |
| Model access (provider protocol adaptation) | SDK → AgentHub | `core/src/llm/` + `@prismshadow/agenthub` — see [Models & Providers](/models) |
| Trace writing and Session-recovery logic | SDK | `core/src/trace/` (the records themselves live in the file layer) |
| Subagent spawning and message forwarding | SDK | the `run_subagent` tool + the injected `SubagentRunner` |
| Multi-user auth and Project authorization | Server | `server/src/auth/`, `server/src/services/project-service.ts` |
| Session indexing, per-Session mutex, SSE forwarding | Server | `server/src/runtime/` — see [Server API](/server-api) |
| Scheduled tasks (execution) | Server | `server/src/runtime/scheduler.ts`; the task definitions live in the file layer at `agent_state/schedule/*.toml` |
| Approval-mode persistence and manual decisions | Server | `server/src/runtime/approvals.ts` + SQLite |
| Usage persistence and cost statistics | Server | `server/src/runtime/usage-recorder.ts`, `services/usage-service.ts` |
| Agent behavior definition (prompts, runtime params) | File layer | `agent_state/system_config.yaml`, `AGENTS.md` — see the [Configuration Reference](/configuration) |
| Skills | File layer | `agent_state/skills/<name>/SKILL.md` — see [Skills](/skills) |
| Secrets | File layer | Vault: `agent_state/.vault.toml`; model credentials: `.project_config.toml` (both 0600) |
| The model table and the default model | File layer | `<project>/.project_config.toml` |
| Run history (the sole source of truth for recovery) | File layer | `traces/<date>/<session>_<index>.jsonl` — see [Sessions & Traces](/sessions-and-traces) |
| Benchmark cases and scores | File layer | `benchmarks/<id>/` — see [Self-Improvement](/self-improvement) |
| Snapshots | File layer | `snapshots/v<version>.tar.gz`; the export/import service lives in the Server |
| Streaming rendering, approval UI, charts | CLI / Web | `cli/src`, `web/src` (pure rendering, no engine logic) |

The one-line rule: **what is editable or recorded lives in files; what makes messages flow lives in the SDK; what needs a resident process and multiple users lives in the Server; the rest is rendering.** The Server's SQLite stores only indexes and aggregates — it never competes with the file layer as a source of truth.

## Source layout

How each package is organized (single-purpose files, split by layer; every file's header comment is its design note):

```text
packages/
├── core/src
│   ├── agent.ts / session.ts       # the createAgent composition layer and Session (run / compact / generateTitle)
│   ├── session-title.ts            # one-shot title generation (out-of-band LLM call, never in Trace)
│   ├── engine/context-engine.ts    # ReAct loop orchestration: turn lifecycle, approvals, carry-over, reconnect, compaction
│   ├── omnimessage/                # types.ts protocol types · builders.ts constructors · aggregate.ts partial aggregation
│   ├── llm/                        # generative-model.ts AgentHub adapter · tool-call-ids.ts id uniqueness
│   ├── environment/                # environment.ts execution close-out · tools/ registry, 9 builtin tools, background sessions
│   ├── state/                      # paths · default-config · project-config · model-catalog
│   │                               # agent-state (Skill install, prompt assembly) · agent-vault · builtin-agents
│   ├── trace/                      # writer.ts append-only JSONL · resume.ts replay-based recovery
│   └── internal/                   # date and Session helpers
├── cli/src                         # commander entry + run / chat / config / serve commands and approval prompts
├── server/src                      # app assembly · db (node:sqlite) · auth · http/routes · runtime · services
├── web/src                         # api client · state · lib/omni stream rendering · components · feature pages
├── skills/                         # loader + the skills/<name>/SKILL.md library
├── landing/                        # the product landing page (with the blog)
└── docs/                           # this documentation site
```

The internals of server and web are detailed on [Server API](/server-api) and the [Web App Guide](/web-app).

## The three-interface boundary

The context_engine is the heart of the system and does exactly two things: it maintains the linear message history, and it orchestrates the event flow between three interfaces. It speaks only [OmniMessage](/omni-message) and performs no protocol conversion:

- **Human** — the user-side boundary. It is deliberately not an interface class: the SDK's single entry point `session.run(newMessages, { approve, signal })` *is* the Human boundary. Input is a list of new OmniMessages plus an approval callback; output is streamed OmniMessages. The CLI and the Server are its two shipped implementations.
- **LLM** — the model-side interface (`LLMInterface`). Translates OmniMessage to requests against the AgentHub model gateway and streamed events back into OmniMessage. All provider protocol adaptation happens inside AgentHub; core never imports a vendor SDK.
- **Environment** — the tool-execution interface (`EnvironmentInterface`). Runs approved tool calls and streams results back.

Why this boundary matters: the kernel contains no provider, tool or UI specifics, so each side swaps by configuration (local shell today, other sandboxes tomorrow; CLI, Web, or programmatic callers) without touching the core. See [Core Interfaces](/interfaces) for the signatures.

## Data flow of one Task

1. Human hands a Prompt (a list of OmniMessages) to `session.run`;
2. the engine issues a Request: the LLMInterface streams `partial_*` fragments and complete messages;
3. every complete `tool_call` triggers one `approve` decision; approved calls run concurrently in the Environment;
4. tool outputs are re-fed in their original order as the next Request's input;
5. the Task ends when a turn produces no `tool_call` (the final answer).

Every message and event flows to two destinations at once: streamed live to the Human, and appended to the [Trace](/sessions-and-traces). Loop details (interruption, reconnect, compaction) are on [The Agent Loop](/agent-loop).

## The state layer

Below the engine sits a purely file-based state layer rooted at `~/.penguin/data` (override with `PENGUIN_HOME`), organized as `<project>/agents/<agent>/`:

- **Agent State** — the `agent_state/` directory: `system_config.yaml`, `AGENTS.md`, Skills, Vault. An Agent's entire behavior is editable files.
- **Project config** — `.project_config.toml`: the model table and credentials; model identity is always the `(provider, model_id)` pair.
- **Trace** — the `traces/` directory: append-only JSONL, the single source of truth for Session recovery.

The Server keeps an additional SQLite index (users, authorization, usage stats) but never duplicates the file layer's facts — the CLI, SDK and Web share one data directory and can be mixed freely.

## Key design decisions

- **One protocol, three jobs**: OmniMessage is simultaneously the SDK's external interface, the Trace on-disk format and the engine's internal currency — what streams, what is stored and what the model sees are the same thing.
- **Errors converge into messages**: the LLM and Environment never throw into the engine; results carry a five-value `stop_reason` (`completed | failed | aborted | timeout | malformed`), and only LLM-side `timeout / malformed` trigger an in-run reconnect.
- **A thin model layer**: core defines only `LLMInterface`; provider adaptation lives entirely in AgentHub (`@prismshadow/agenthub`), which is what makes any OpenAI-compatible endpoint reachable. See [Models & Providers](/models).

Source entry points: `packages/core/src/engine/context-engine.ts`, `packages/core/src/interfaces.ts`.
