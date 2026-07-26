---
title: Core Interfaces
description: A top-down tour of the contracts — full LLMInterface and EnvironmentInterface signatures, inner types field by field, and every swappable seam.
---

The context_engine depends on three interfaces: Human, LLM and Environment. All protocol conversion happens inside the implementations — the engine sees only [OmniMessage](/omni-message). This page goes top-down: the two big interface signatures and the Human boundary first, then each interface's inner types layer by layer. All types are exported by `@prismshadow/penguin-core`; source: `packages/core/src/interfaces.ts`.

## Overview

```text
            Human (a boundary, not a class)
            session.run(newMessages, { approve, signal })
                          │ ▲
                          ▼ │ streamed OmniMessage
                    context_engine
                     │            │
        LLMInterface │            │ EnvironmentInterface
                     ▼            ▼
        GenerativeModel        Environment
         └─ AgentHub gateway    └─ BuiltinTool registry (exec_command …)
```

| Interface | Contract | Built-in implementation |
| --- | --- | --- |
| Human | `session.run`'s inputs and streamed output | CLI, Server (SSE) |
| LLM | `LLMInterface.streamGenerate` | `GenerativeModel` (over AgentHub) |
| Environment | `EnvironmentInterface.executeTool` et al. | `Environment` + the builtin tool registry |

Two iron rules run through every interface: **never throw into the engine** (errors converge into messages/returns carrying a `stop_reason`), and **the streaming discipline** (`start → delta → stop`, complete message immediately after).

## LLMInterface

The complete model-side contract is a single method:

```ts
interface LLMInterface {
  streamGenerate(parameters: GenerativeModelParameters): AsyncGenerator<OmniMessage, LLMOutcome>;
}

interface GenerativeModelParameters {
  newMessages: OmniMessage[];    // only this turn's new messages (the impl owns history; mixed roles rejected)
  signal?: AbortSignal;
  thinkingLevel?: ThinkingLevelName;   // per-request override; omitted = the construction default
}
```

The generator yields `partial_*` fragments and complete messages, emits Token usage as `token_usage` events, and reports the terminal state via its **return value** (not a yielded message).

### LLMOutcome semantics

```ts
interface LLMOutcome {
  status: StopReason;   // completed | timeout | malformed | aborted | failed
  message?: string;     // display text when failed
}
```

| status | Meaning | Engine reaction |
| --- | --- | --- |
| `completed` | finished normally (token_usage already emitted) | proceed |
| `timeout` | timeout / lost connection | auto-reconnect within the run |
| `malformed` | response parse failure | auto-reconnect within the run |
| `aborted` | user interrupt | stop, hand back to the user |
| `failed` | non-retryable (auth/params, …) | stop, hand back to the user |

Implementation constraints: never throw; no internal retries — reconnecting is the engine's job (see [The Agent Loop](/agent-loop)).

### GenerativeModelConfig

The built-in implementation's init config, field by field:

```ts
interface GenerativeModelConfig {
  modelId: string;
  apiKey?: string;
  baseUrl?: string;
  clientType?: string;             // AgentHub client protocol (openai / …); inferred from modelId when omitted
  tools: ToolDefinition[];
  systemPrompt?: string;           // fully assembled system prompt, placeholders substituted
  contextWindow?: number;
  maxTokens?: number;
  thinkingLevel?: ThinkingLevelName;   // construction default (a per-request parameter can override); "none" | "low" | "medium" | "high" | "xhigh"
  requestTimeoutMs?: number;       // per-Request timeout, default 120000; <=0 disables
  toolCallIds?: ToolCallIdAllocator;   // Session-level tool_call_id registry (pass the same instance across compaction)
}
```

### The built-in implementation: GenerativeModel

`GenerativeModel` (`packages/core/src/llm/generative-model.ts`) grounds the contract on the `AutoLLMClient` of the `@prismshadow/agenthub` model gateway:

- the gateway maintains conversation history **statefully**, receiving only new messages each turn; resuming a Session replays committed history through a one-time `setHistory`;
- an internal `EventTranslator` translates gateway stream events into `partial_*` fragments plus complete messages, preserving each item's opaque `fidelity` payload verbatim; segmentation mirrors the gateway's own aggregation — a thinking block is closed by its fidelity payload and a run of equal fidelity stays one block (OpenAI-compatible clients stamp every delta with the same `{ reasoning_field }`, which must not split blocks), while a text segment splits on a differing `fidelity.phase` and closes on a `fidelity.signature`, fidelity keys accumulating on merge; complete messages settle in thinking → text → tool_call order;
- `ToolCallIdAllocator` disambiguates providers that use the function name as the call id (append `#n` inbound, strip outbound), scoped to the whole Session;
- provider differences (tool-call formats, reasoning content, streaming events) are absorbed entirely inside the gateway — see [Models & Providers](/models).

## EnvironmentInterface

The complete tool-execution contract:

```ts
interface EnvironmentInterface {
  listTools(): Promise<ToolDefinition[]>;
  executeTool(request: ToolExecutionRequest): AsyncGenerator<OmniMessage>;
  toolPermission(name: string): "r" | "rw" | undefined;   // for frontend approval-mode decisions
  dispose?(): void;                                        // release runtime resources; idempotent
}
```

`executeTool` yields `partial_tool_call_output` fragments and ends with exactly one complete `tool_call_output`; `origin`-tagged nested messages (e.g. forwarded by `run_subagent`) pass through unchanged. Rendering is explicitly not this interface's concern — streaming rendering belongs to the CLI / Web front ends.

### ToolExecutionRequest and EnvironmentConfig

```ts
interface ToolExecutionRequest {
  toolCall: OmniMessage<ToolCallPayload>;   // an approved call
  signal?: AbortSignal;
  approve?: ApproveFn;                      // forwarded to tools that spawn child Sessions (approval inheritance)
}

interface EnvironmentConfig {
  workspaceDir: string;
  toolConfig: ToolConfig;                   // { customTools: ToolDefinitionConfig[]; mcpServers: MCPServerConfig[] }
  services?: EnvironmentServices;           // runtime services injected into individual tools
  vault?: Record<string, string>;           // Vault env vars, injected into exec_command / input_command subprocesses
}

interface EnvironmentServices {
  subagentRunner?: SubagentRunner;          // needed by run_subagent
  visionDescriber?: VisionDescriberService; // needed by describe_image on text-only models
  commandSessions?: CommandSessionManager;  // long-running command session registry (built by Environment)
  subagentSessions?: SubagentSessionManager;// background subagent session registry (likewise)
}

interface MCPServerConfig {
  name: string;
  config: Record<string, unknown>;
}
```

### The inner tool contract: BuiltinTool

Inside the Environment, an individual tool follows a deliberately narrower contract ("loose tool, strict framework"):

```ts
interface BuiltinTool {
  name: string;
  definition: ToolDefinitionConfig;
  execute(
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,       // { workspaceDir, toolCallId, signal?, approve? }
  ): AsyncGenerator<OmniMessage, ToolResult | void>;
}

interface ToolDefinitionConfig {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;   // JSON Schema
  permission?: "r" | "rw";
  forModel?: "vision" | "text-only";      // assembled per session-model class
  timeoutMs?: number;                     // default 120000; <=0 disables
  maxOutputLength?: number;               // default 16000, head-kept truncation; <=0 disables
}
```

A tool emits only content deltas; framing, timeouts, truncation, `stop_reason` priority and errors-to-messages are all handled centrally by the Environment — it is close to impossible for a tool author to break the protocol. Extension is registration: add one `name → factory` entry to `BUILTIN_TOOL_FACTORIES` (`packages/core/src/environment/tools/registry.ts`). Per-tool parameters and behavior: [Tools & Approval](/tools).

## The Human boundary

Human is deliberately not an interface class. The SDK caller *is* the Human:

```ts
const session = await agent.createSession({ workspaceDir, provider, modelId });

session.run(
  newMessages: OmniMessage[],                    // input: the Prompt
  opts?: RunOptions,
): AsyncGenerator<OmniMessage>;                  // output: streamed OmniMessage

interface RunOptions {
  signal?: AbortSignal;    // interrupt (e.g. Ctrl-C)
  approve?: ApproveFn;     // per-tool approval; denies everything when omitted
  thinkingLevel?: ThinkingLevelName;   // this run's thinking level (per-turn; compaction requests unaffected)
}
```

The CLI wires terminal I/O onto this boundary; the Server wires HTTP requests and SSE channels onto it. Any programmatic caller that connects becomes a new Human implementation — nothing to register.

## ApproveFn

```ts
type ApprovalDecision = "allow" | "deny";
type ApproveFn = (toolCall: OmniMessage<ToolCallPayload>) => Promise<ApprovalDecision>;
```

Constraints: called exactly once per complete `tool_call`; a throwing callback counts as `deny`; when none is injected the engine denies everything (conservative default). A Subagent inherits its parent's approval callback (invoked with an `origin` tag), so the approval policy spans the whole delegation tree.

## Subagent interfaces

Subagent creation is injected at the `createAgent` composition layer, so the Environment never back-depends on the layers above it:

```ts
interface SubagentRunner {
  // Precheck errors (depth limit, unknown agent) are thrown — Environment collapses them to failed
  spawn(input: {
    agentId?: string;     // defaults to the current Agent (self-spawn)
    modelId?: string;     // omitted = inherit the parent Session's model
  }): Promise<SubagentHandle>;
}

interface SubagentHandle {
  sessionId: string;      // the child Session id: the origin hop; subagent_id derives from its tail
  run(input: {
    prompt: string;
    signal?: AbortSignal;
    approve?: ApproveFn;  // the parent's approval callback — forwarding is inheritance
  }): AsyncGenerator<OmniMessage>;
  dispose(): void;        // release the child Session's runtime resources; idempotent
}
```

Spawning and running are separate, so the same child Session can accept a follow-up Prompt after a turn ends (a long-running Subagent, driven via `input_subagent`). Child Sessions run in the same Workspace with their own Trace; nesting depth is currently capped at 1.

## VisionDescriberService

The image proxy-reading service for text-only models (needed by `describe_image`):

```ts
interface VisionDescriberService {
  modelId: string | null;          // null when the Project has no vision_model — the tool ends with a failed explanation
  createLLM?: () => LLMInterface;  // one-shot LLM for the vision model (no tools, no system prompt)
}
```

## Extension seams

| To … | Do … |
| --- | --- |
| Swap or customize model access | implement `LLMInterface` (or just set `client_type` for OpenAI-compatible endpoints) |
| Swap the execution sandbox | implement `EnvironmentInterface` |
| Add a tool | implement `BuiltinTool` + register a factory; or declare it under `tools.builtin` in `system_config.yaml` |
| Customize approval policy | inject an `ApproveFn` (the CLI/Web modes are wrappers over it) |
| Change an Agent's behavior | edit its Agent State: `system_config.yaml`, `AGENTS.md`, Skills — see the [Configuration Reference](/configuration) |
