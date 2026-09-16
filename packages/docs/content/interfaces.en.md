---
title: Core Interfaces
description: The Human, LLM and Environment contracts behind the engine, with their full signatures, inner types and extension seams.
---

The `context_engine` depends on three interfaces: Human, LLM and Environment. All protocol conversion happens inside the implementations, so the engine sees only [OmniMessage](/omni-message).

This page follows a turn's control flow: [the Human boundary](#the-human-boundary), the [LLM contract](#llminterface), the [approval callback](#approvefn) and the [Environment contract](#environmentinterface). It ends with the [subagent](#subagent-interfaces) and [vision](#visiondescriberservice) services and the [extension seams](#extension-seams).

All types are exported by `@prismshadow/penguin-core`. The source lives in `packages/core/src/interfaces/`:

- `llm.ts`: what the model side needs.
- `environment.ts`: what the Environment side needs.
- `shared.ts`: the vocabulary both sides genuinely need.
- `index.ts`: the barrel behind the `@prismshadow/penguin-core/interfaces` subpath.

## The three boundaries

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

Every interface follows two rules:

- **Never throw into the engine.** Errors become messages or return values that carry a `stop_reason`.
- **Follow the streaming discipline.** A stream goes `start → delta → stop`, and the complete message follows immediately.

### Message plane and control plane

The **content** that crosses all three boundaries is OmniMessage and nothing else:

- `session.run`'s input and its streamed output
- `streamGenerate`'s input array and its yielded stream
- `executeTool`'s approved tool call and its output stream
- a subagent round's input and its forwarded messages
- every Trace write

What travels alongside it is the **control plane**. It is deliberately not message-shaped, because none of it is conversation content:

| Control-plane item | Where | Why it is not a message |
| --- | --- | --- |
| `signal: AbortSignal` | `RunOptions`, `GenerativeModelParameters`, `ToolExecutionRequest` | An interruption that had to wait its turn in a message queue would not be an interruption. |
| `thinkingLevel` | `GenerativeModelParameters` | A per-request parameter, like a timeout: it says how to run the request, not what to say. The engine holds the live value as its own state (`ContextEngine.setThinkingLevel`, fed by the `Session.thinkingLevel` setter, the soft-limited knob). When a request omits it, the LLM object's construction default applies, which is the context's opening level. `RunOptions` carries no level. |
| `approve` and its `ApprovalDecision` | `RunOptions`, `ToolExecutionRequest` | The callback takes an OmniMessage tool call. The answer is a three-value enum, which the engine turns into an `approval_decision` message as soon as it has it. |
| `LLMOutcome` | `streamGenerate`'s generator return value | The request's terminal state, which the engine's retry and reconnect policy branches on. A generator's return value is guaranteed by the type system; "the last message yielded must be a `request_end`" could only ever be a runtime convention. The engine writes that `request_end` from it. |

Everything else that is not OmniMessage belongs to the Environment's management plane, described under [EnvironmentInterface](#environmentinterface).

## The Human boundary

Human is deliberately not an interface class. The SDK caller *is* the Human:

```ts
const session = await agent.createSession({ workspaceDir, provider, modelId });

session.run(
  newMessages: OmniMessage[],                    // input: the Prompt
  opts?: RunOptions,
): AsyncGenerator<OmniMessage, RunCutoff | null>; // output: streamed OmniMessage; returns null when the run completed

interface RunOptions {
  signal?: AbortSignal;    // interrupt (e.g. Ctrl-C)
  approve?: ApproveFn;     // per-tool approval; denies everything when omitted
  preToolUse?: PreToolUseFn; // pre-tool-use hook consult; the Session wires it from installed hook packages
}

interface RunCutoff {       // how a run was cut off early
  kind: "abort" | "llm_failure" | "compaction_failure" | "max_turns";
  errorCode?: ErrorCode;    // mirrors the terminal record's error_code (none for max_turns)
  errorMessage?: string;    // mirrors the terminal record's error_message
}
```

The CLI wires terminal I/O onto this boundary. The Server wires HTTP requests and SSE channels onto it. Any programmatic caller that connects becomes a new Human implementation, with nothing to register.

The return value tells a consumer whether the run really finished. Failures emit no abort event, only their terminal `request_end` or `compaction_end` record, so code that must not treat a cut-off run as finished reads `RunCutoff` instead of inspecting the stream.

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

The generator yields `partial_*` fragments and complete messages, and emits Token usage as `token_usage` events. It reports the terminal state through its **return value**, not a yielded message.

### LLMOutcome semantics

```ts
interface LLMOutcome {
  status: StopReason;      // completed | aborted | retryable | fatal
  errorCode?: ErrorCode;   // classified cause on a non-completed failure; carried onto request_end as error_code
  errorMessage?: string;   // failure detail: on fatal, and on retryable when a concrete error was caught;
                           // carried onto request_end as error_message, so the errors panel shows
                           // the real reason behind a retried request
}
```

| status | Meaning | Engine reaction |
| --- | --- | --- |
| `completed` | Finished normally (`token_usage` already emitted) | Proceed |
| `retryable` | A failure worth retrying: transport drops, idle timeouts, 408/429/5xx, malformed or truncated responses, and anything unclassifiable | Reconnect within the run on the backoff ladder |
| `fatal` | A failure no retry can fix: a provider 4xx rejection (408 and 429 excluded), rejected credentials, or a deterministic client-side rejection before any network I/O (for example, fast mode on a model without a fast tier) | Stop the run and surface `errorMessage` |
| `aborted` | User interrupt | Stop and hand back to the user |

The status answers one question: should this request be retried? `errorCode` says what kind of failure it was. Unclassifiable errors are `retryable` on purpose: the fatal detector is an allowlist, so a gateway that words a transient fault its own way keeps its retries.

The fix for a `fatal` outcome is a configuration or credential change, then a new request. Only the model reference is fixed at Session creation. Credentials come from the current Project config, so after a key update the Session can continue.

Implementation constraints:

- Never throw.
- Do no internal retries. Reconnecting is the engine's job; see [The Agent Loop](/agent-loop).

### GenerativeModelConfig

The built-in implementation's init config, field by field:

```ts
interface GenerativeModelConfig {
  modelId: string;
  apiKey?: string;
  baseUrl?: string;
  clientType?: string;             // AgentHub client protocol (openai-chat / openai-responses / …); inferred from modelId when omitted
  tools: ToolDefinition[];
  systemPrompt?: string;           // fully assembled system prompt, placeholders substituted
  contextWindow?: number;
  maxTokens?: number;
  fastMode?: boolean;              // per-model fast mode (AgentHub fast_mode; premium faster tier), off by default
  thinkingLevel?: ThinkingLevelName;   // construction default (a per-request parameter can override); "none" | "low" | "medium" | "high" | "xhigh" | "max"
  requestTimeoutMs?: number;       // Request idle budget: the longest wait for the next upstream event, default 300000; <=0 disables
  sessionId?: string;              // the Session's id, sent only to endpoints whose attribution header names the conversation
  toolCallIds?: ToolCallIdAllocator;   // Session-level tool_call_id registry (pass the same instance across compaction)
}
```

### The built-in implementation: GenerativeModel

`GenerativeModel` (`packages/core/src/llm/generative-model.ts`) builds the contract on the `AutoLLMClient` of the `@prismshadow/agenthub` model gateway.

**History.** The gateway keeps conversation history **statefully** and receives only the new messages each turn. Resuming a Session replays the committed history through a one-time `setHistory`.

**Event translation.** An internal `EventTranslator` turns gateway stream events into `partial_*` fragments plus complete messages, and keeps each item's opaque `fidelity` payload verbatim. Segmentation mirrors the gateway's own aggregation:

- A thinking block is closed by its fidelity payload.
- A run of equal fidelity stays one block. OpenAI-compatible clients stamp every delta with the same `{ reasoning_field }`, which must not split blocks.
- A text segment splits on a differing `fidelity.phase` and closes on a `fidelity.signature`. Fidelity keys accumulate on merge.
- Complete messages settle in thinking → text → tool_call order.

**Thought summaries.** Every request asks the gateway for thought summaries (`thinking_summary`). No provider rejects the flag: the gateway drops it for families without such a feature, and the Claude family reads it as summarized thinking. Besides letting the reader watch the model reason, it keeps events arriving during a reasoning phase.

**Idle timeout.** Those events are what `requestTimeoutMs` measures. The timer runs only while awaiting the next upstream event and resets on each one. It never counts consumer-side time such as yielding, approvals or Trace writes. It bounds silence, not the length of a response.

**Tool call ids.** `ToolCallIdAllocator` handles providers that use the function name as the call id: it appends `#n` inbound and strips it outbound. Its scope is the whole Session.

**Provider differences.** Tool-call formats, reasoning content and streaming events are absorbed entirely inside the gateway. See [Models & Providers](/models).

## ApproveFn

`RunOptions` and `ToolExecutionRequest` both carry this callback type:

```ts
type ApprovalDecision = "allow" | "deny" | "forbidden"; // "forbidden" = the command policy's veto
type ApproveFn = (toolCall: OmniMessage<ToolCallPayload>) => Promise<ApprovalDecision>;
```

| Rule | Behavior |
| --- | --- |
| Call frequency | Called exactly once per complete `tool_call` |
| Callback throws | Counts as `deny` |
| No callback injected | The engine denies everything (the conservative default) |
| Subagents | A subagent inherits its parent's approval callback, invoked with an `origin` tag, so the approval policy spans the whole delegation tree |

`"forbidden"` is never a host's answer. `Session.run` wraps the injected callback with the [Project command policy](/configuration#command-policy), so a vetoed command gets `"forbidden"` before the host is asked at all.

Either denial produces one fixed `aborted` output line: "Tool call denied by user." for `"deny"`, and "Tool call denied by policy." for `"forbidden"`. The decision value itself rides the `approval_decision` event, so the Trace names the decider without an extra field. An existing callback that returns only `"allow"` or `"deny"` needs no change.

## EnvironmentInterface

The core of the tool-execution contract:

```ts
interface EnvironmentInterface {
  listTools(): Promise<ToolDefinition[]>;
  executeTool(request: ToolExecutionRequest): AsyncGenerator<OmniMessage>;
  toolPermission(name: string): "r" | "rw" | undefined;   // for frontend approval-mode decisions
  dispose?(): void;                                        // release runtime resources; idempotent
}
```

The interface carries two planes, and only the first belongs to the agent loop:

- **The message plane** is `executeTool`, the only method `context_engine` calls here. An OmniMessage tool call goes in; a stream of OmniMessage comes out.
- **The management plane** is `listTools`, `toolPermission`, `dispose` and the optional members below. None of them pass through the engine. They serve Session assembly and a host's own UI, such as the Web App's process and subagents panels or an approval mode's permission lookup. They are ordinary method calls that return ordinary data, which is why they are not message-shaped: making them messages would not make the engine's boundary any purer.

| Optional management member | Purpose |
| --- | --- |
| `listBackgroundCommands()`, `killBackgroundCommand(processId)` | List the background command processes; kill one by id (the whole process group) |
| `probeBackgroundCommandServices()` | Refresh the listen-port probe behind a command's detected service URL |
| `detachToolCall(toolCallId)` | Ask one running call to continue as a background task (the Web App's per-card button); answers `detached`, `not_running` or `not_detachable` |
| `listBackgroundSubagents()`, `hasRunningBackgroundSubagents()` | List the live child sessions; report whether a background child is mid-round |
| `sendToBackgroundSubagent(childSessionId, messages, opts?)` | Steer a running child, start a follow-up round on an idle one, or revive a released one (`opts.resume`); answers `steered`, `started`, `resumed`, `busy` or `gone` |
| `abortBackgroundSubagentRun(childSessionId)` | Stop a child's current run; the session survives |
| `setBackgroundSubagentThinkingLevel(childSessionId, level)` | Pin a live child's thinking level |
| `setSubagentApprovalFallback(approve)` | Attach the host's session-lifetime fallback approval sink for child sessions |
| `setSubagentStateListener`, `setBackgroundStateListener`, `setBackgroundTaskListener`, `setBackgroundMessageListener` | Attach the single listener for subagent run-state changes, background-task state changes, completion reports and live background-subagent messages |

`executeTool` yields `partial_tool_call_output` fragments and ends with exactly one complete `tool_call_output`. Nested messages tagged with `origin`, such as those `run_subagent` forwards, pass through unchanged.

The built-in Environment can keep truncated text in the Session scratchpad without exposing storage lifecycle hooks through this public interface. The recovery path it shows the model is a plain absolute path. On Windows the path uses forward slashes, which Node's fs APIs and the package's (Git) Bash tool shell both accept, so the same spelling works as a `read_file` argument and inside shell commands.

Rendering is not this interface's concern. Streaming rendering belongs to the CLI and Web front ends.

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
  sessionScratchpadDir?: string;            // this Session's scratchpad (scratchpad/<sessionId>); enables truncated-output recovery
  services?: EnvironmentServices;           // runtime services injected into individual tools
  vault?: Record<string, string>;           // Vault env vars, injected into exec_command / input_command subprocesses
  proxyEnv?: () => ProxyEnvPolicy | null;   // command-subprocess proxy policy; re-read per spawn, absent or null = pass through
  controlEnv?: () => Record<string, string>; // host control variables (API address, token, Session coordinates); re-read per
                                            // spawn; override vault entries, never the hardened ones
  pathPrepend?: () => string[];             // directories put at the front of PATH for command subprocesses; re-read per spawn
  confineSpawn?: () => SpawnConfiner | null; // sandbox confinement for command subprocesses; re-read per spawn,
                                            // absent or null = commands spawn unconfined
}

// "strip" removes HTTP(S)_PROXY/ALL_PROXY (NO_PROXY kept); "inject" forces the explicit
// proxy over the inherited env: HTTP(S)_PROXY (+ lowercase twins) = url, NO_PROXY = noProxy
// (supplied pre-merged by the caller), inherited ALL_PROXY removed. Vault entries still win.
type ProxyEnvPolicy = { mode: "strip" } | { mode: "inject"; url: string; noProxy: string };

// Rewrites the exact argv a command is about to spawn so it runs confined. Fail-closed: a
// confiner that cannot enforce its policy throws, and the command fails to spawn.
type SpawnConfiner = (
  argv: readonly string[],
  opts: { cwd: string; workspaceDir: string },
) => readonly string[];

interface EnvironmentServices {
  subagentRunner?: SubagentRunner;          // needed by run_subagent
  visionDescriber?: VisionDescriberService; // injected for text-only models only: read_file describes images through it
  commandSessions?: CommandSessionManager;  // long-running command session registry (built by Environment)
  subagentSessions?: SubagentSessionManager;// background subagent session registry (likewise)
  backgroundDone?: (event: BackgroundTaskDoneEvent) => void; // completion-report sink for run_in_background launches (likewise)
  backgroundForward?: (msg: OmniMessage) => void;           // live message tap of a background subagent (likewise)
}

interface MCPServerConfig {
  name: string;                             // tool-name prefix: discovered tools appear as mcp__<name>__<tool>
  config: Record<string, unknown>;          // stays an open object at this seam; typed at assembly time by
                                            // environment/mcp into a transport description (stdio / http / sse),
                                            // see /tools § MCP Servers
}
```

`Agent.createSession()` and `resumeSession()` pass the Session scratchpad directory automatically. A standalone embedder that owns a stable per-Session directory opts in by supplying it. No archive-specific type is exposed:

```ts
const environment = new Environment({
  workspaceDir,
  toolConfig,
  sessionScratchpadDir, // e.g. <dataRoot>/<project>/agents/<agent>/scratchpad/<sessionId>
});
```

### The inner tool contract: BuiltinTool

Inside the Environment, each tool follows a deliberately narrower contract ("loose tool, strict framework"):

```ts
interface BuiltinTool {
  name: string;
  definition: ToolDefinitionConfig;
  detachable?: boolean;              // has a background form a running call can be moved to
  execute(
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,       // { workspaceDir, toolCallId, signal?, detachSignal?, approve? }
  ): AsyncGenerator<OmniMessage, ToolResult | void>;
}

interface ToolDefinitionConfig {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;   // JSON Schema
  permission?: "r" | "rw";
  forModel?: "vision" | "text-only";      // assembled per session-model class (unset by the built-in entries)
  timeoutMs?: number;                     // default 120000; <=0 disables
  maxOutputLength?: number;               // default 16000, head-kept truncation; <=0 disables
  call_description?: boolean;             // false filters the `description` call argument out of the schema; missing = kept
}
```

A tool emits only content deltas. The Environment handles framing, timeouts, truncation, `stop_reason` priority and turning errors into messages centrally, so a tool author can hardly break the protocol.

Adding a tool is registration: add one `name → factory` entry to `BUILTIN_TOOL_FACTORIES` (`packages/core/src/environment/tools/registry.ts`). For each tool's parameters and behavior, see [Tools & Approval](/tools).

## Subagent interfaces

Subagent creation is injected at the `createAgent` composition layer, so the Environment never depends on the layers above it:

```ts
interface SubagentRunner {
  // Precheck errors (depth limit, unknown agent) are thrown — Environment collapses them to a fatal result
  spawn(input: {
    agentId?: string;     // defaults to the current Agent (self-spawn)
    modelId?: string;     // paired with provider; both omitted = inherit the parent Session's model
    provider?: string;    // required whenever modelId is given (a model reference is the pair)
    thinkingLevel?: ThinkingLevelName; // omitted = inherit the parent Session's effective level
  }): Promise<SubagentHandle>;
  resume?(input: { agentId?: string; sessionId: string }): Promise<SubagentHandle>; // revive a released child Session
}

interface SubagentHandle {
  sessionId: string;      // the child Session id: the origin hop; subagent_id derives from its tail
  takeMeta?(): OmniMessage | null; // one-shot take of the child's session_meta (a background launch forwards it upfront)
  run(input: {
    messages: OmniMessage[];  // the round's input, the shape Session.run takes a Prompt in
    signal?: AbortSignal;
    approve?: ApproveFn;  // the parent's approval callback — forwarding is inheritance
  }): AsyncGenerator<OmniMessage, RunCutoff | null>; // returns null when the round completed
  steer?(messages: OmniMessage[]): boolean; // queue a steering message for a running round; false when none is running
  setThinkingLevel?(level: ThinkingLevelName): void; // pin the child's thinking level from its next request
  dispose(): void;        // release the child Session's runtime resources; idempotent
}
```

Spawning and running are separate, so the same child Session can accept a follow-up Prompt after a round ends. This is how `input_subagent` drives a long-running subagent. A released child Session can be revived with `resume`, which restores its own history, model and Workspace. Child Sessions run in the same Workspace, each with its own Trace. Nesting depth is currently capped at 1.

A round reports a cut-off through its return value, so the parent reports that round as failed instead of handing the model half an answer.

A round's input is an OmniMessage list: the same shape `steer` takes, and the same shape a host passes to `EnvironmentInterface.sendToBackgroundSubagent`. Both ways into a child session speak one vocabulary. The caller owns each message's `sender`. The model's own dispatch (`run_subagent`, `input_subagent`) stamps `parent_agent`, while a human's message from a host panel carries none, so the child's Trace records who actually spoke.

## VisionDescriberService

The image proxy-reading service for text-only models. `read_file` needs it when the Session model cannot view images, and its presence is how the tool knows:

```ts
interface VisionDescriberService {
  modelId: string | null;          // null when the Project has no vision_model — the tool ends with a failed explanation
  createLLM?: () => LLMInterface;  // one-shot LLM for the vision model (no tools, no system prompt)
}
```

## Extension seams

| To … | Do … |
| --- | --- |
| Swap or customize model access | Implement `LLMInterface` (or just set `client_type` for OpenAI-compatible endpoints) |
| Swap the execution sandbox | Implement `EnvironmentInterface` |
| Confine the commands an agent runs | Supply `confineSpawn` with a `SpawnConfiner` |
| Add a tool | Implement `BuiltinTool`, register a factory, and list the tool under `tools.builtin` in `system_config.yaml` (entries without a registered factory are skipped); or connect an MCP server under `tools.mcpServers` |
| Customize approval policy | Inject an `ApproveFn` (the CLI and Web approval modes are wrappers over it) |
| Change an agent's behavior | Edit its Agent State (`system_config.yaml`, `AGENTS.md`, Skills); see the [Configuration Reference](/configuration) |
