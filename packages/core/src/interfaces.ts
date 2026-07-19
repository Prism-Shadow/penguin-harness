/**
 * Internal SDK interface contracts: LLM, Environment.
 *
 * `context_engine` only handles OmniMessage; protocol conversion and concrete implementations
 * are each interface's own responsibility.
 * Human is not an "interface/class with methods" but the SDK's input/output boundary itself:
 * output is streamed by `Session.run()` as an async generator, and input is delivered via
 * `run`'s `RunOptions` — approvals are requested one at a time through the injected `approve`
 * callback, and interruption goes through `signal`. Hence no Human interface is defined here.
 *
 * These types form the foundational contract shared by all units; implementing units integrate
 * against them.
 *
 * Docs: packages/docs/content/interfaces.{zh,en}.md (site path /docs/interfaces) explains each
 * contract and its extension seams — keep the page in sync when changing signatures here.
 */
import type {
  ApprovalDecision,
  OmniMessage,
  StopReason,
  ToolCallPayload,
  ToolDefinition,
} from "./omnimessage/types.js";
// Concrete classes, used only for EnvironmentServices type annotations (type-only import; no runtime dependency, no circular reference).
import type { CommandSessionManager } from "./environment/tools/command/session-manager.js";
import type { SubagentSessionManager } from "./environment/tools/subagent/session-manager.js";
import type { ToolCallIdAllocator } from "./llm/tool-call-ids.js";

// ---------------------------------------------------------------------------
// Tool definitions and configuration
// ---------------------------------------------------------------------------

// ToolDefinition is defined in omnimessage/types.ts (session_meta embeds the full tool schema directly); re-exported here to keep the original import path.
export type { ToolDefinition } from "./omnimessage/types.js";

/** Tool permission: read-only / read-write. */
export type ToolPermission = "r" | "rw";

/**
 * Runtime configuration for a single tool.
 * Docs: /docs/tools § "Configuration fields".
 */
export interface ToolDefinitionConfig {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  permission?: ToolPermission;
  /**
   * Which class of session model this entry targets: `"vision"` only for models that support
   * images (e.g. read_image), `"text-only"` only for text-only models (e.g. describe_image);
   * omitted means available for all models. Filtered by session model at assembly time
   * (see `selectBuiltinToolsForModel`).
   */
  forModel?: "vision" | "text-only";
  /** Timeout for a single tool call (ms); on timeout, ends as `failed`; <=0 disables it. */
  timeoutMs?: number;
  /** Max length of tool output; Environment truncates from the front (keeping the head) if exceeded; <=0 disables it. */
  maxOutputLength?: number;
}

export interface MCPServerConfig {
  name: string;
  config: Record<string, unknown>;
}

/** Set of tool configs required to initialize Environment. */
export interface ToolConfig {
  customTools: ToolDefinitionConfig[];
  mcpServers: MCPServerConfig[];
}

/**
 * Per-tool approval callback: the Human boundary gives allow/deny for each complete `tool_call`.
 * `context_engine` calls it once per tool call within a turn. Subagents forward the parent's
 * approval callback, so the child Agent **inherits the parent Agent's approval mode**.
 * Docs: /docs/interfaces § "ApproveFn".
 */
export type ApproveFn = (toolCall: OmniMessage<ToolCallPayload>) => Promise<ApprovalDecision>;

// ---------------------------------------------------------------------------
// LLM interface
// ---------------------------------------------------------------------------

export type ThinkingLevelName = "none" | "low" | "medium" | "high" | "xhigh";

/**
 * GenerativeModel initialization config.
 * Docs: /docs/interfaces § "GenerativeModelConfig".
 */
export interface GenerativeModelConfig {
  modelId: string;
  apiKey?: string;
  baseUrl?: string;
  /**
   * AgentHub client protocol (`openai` / `claude-4-8` / `deepseek-v4` / …). If omitted, AgentHub
   * infers it from `modelId`; custom-named models or third-party models using the OpenAI protocol
   * must specify it explicitly.
   */
  clientType?: string;
  tools: ToolDefinition[];
  /** Full system Prompt after placeholder substitution in the system_config.system_prompt template. */
  systemPrompt?: string;
  contextWindow?: number;
  maxTokens?: number;
  thinkingLevel?: ThinkingLevelName;
  /** LLM Request timeout (ms): from system_config.model.timeoutMs; <=0 disables it. Defaults to 120000. */
  requestTimeoutMs?: number;
  /**
   * tool_call_id uniqueness registry (Session-level). Pass the same instance when rebuilding a new
   * GenerativeModel on compaction so the uniqueness scope covers the whole Session; defaults to a fresh
   * one. See llm/tool-call-ids.ts.
   */
  toolCallIds?: ToolCallIdAllocator;
}

export interface GenerativeModelParameters {
  /** OmniMessage array for the input newly added this turn; implementations must merge it into a single UniMessage (multiple roles not accepted). */
  newMessages: OmniMessage[];
  signal?: AbortSignal;
}

/**
 * The terminal state of an LLM request, returned as the **return value** of the `streamGenerate`
 * async generator (not a yielded message). The status values share the same five-value protocol
 * as OmniMessage `stop_reason`:
 *   - `completed`: finished normally (already produced `token_usage`);
 *   - `timeout`: LLM timed out or lost connection, needs reconnect — retried by `context_engine`
 *     within the same run;
 *   - `malformed`: AgentHub response failed JSON parsing, needs reconnect — also retried by
 *     `context_engine`;
 *   - `aborted`: user-initiated interruption — stop and hand back to the user;
 *   - `failed`: other non-retryable errors (auth/params, etc.) — stop and hand back to the user
 *     (`message` provides the display text).
 * Docs: /docs/interfaces § "LLMOutcome semantics".
 */
export interface LLMOutcome {
  status: StopReason;
  message?: string;
}

/**
 * A stateful LLM object attached to a Session.
 * `streamGenerate` yields streaming `partial_*` messages as an async generator, and appends the
 * corresponding complete `model_msg` once each fragment ends; Token usage is emitted as a
 * `token_usage` event_msg. **Never throws to `context_engine`**: any interruption/exception is
 * closed off in well-formed structure and returned normally, and **must** report the terminal
 * state via `LLMOutcome` — error handling happens entirely inside the LLM interface, and
 * `context_engine` only decides subsequent actions based on the outcome.
 * Docs: /docs/interfaces § "LLMInterface".
 */
export interface LLMInterface {
  streamGenerate(parameters: GenerativeModelParameters): AsyncGenerator<OmniMessage, LLMOutcome>;
}

// ---------------------------------------------------------------------------
// Environment interface
// ---------------------------------------------------------------------------

/**
 * Handle for a child Agent session: derived by `SubagentRunner.spawn`,
 * representing a child Session that can run over multiple turns. Deriving (spawn) is separate
 * from running (run), so the same child Session can accept an additional Prompt and keep running
 * after a turn ends (a long-running subagent, accessed via `input_subagent`).
 * Docs: /docs/interfaces § "Subagent interfaces".
 */
export interface SubagentHandle {
  /** The child Session's id: the origin hop of messages produced by run; `subagent_id` is derived from its tail for the frontend to correlate. */
  sessionId: string;
  /**
   * Runs one turn of a task on the child Session. Emitted child-session messages **all already
   * carry the origin marker** (the child Session id); the first message of the first run is the
   * child Session's `session_meta`, and tool_calls received by the forwarded approval callback
   * carry origin as well.
   */
  run(input: {
    /** The task Prompt handed to the child Agent. */
    prompt: string;
    signal?: AbortSignal;
    /** The parent Agent's approval callback; forwarded to the child Session to inherit the parent's approval mode. */
    approve?: ApproveFn;
  }): AsyncGenerator<OmniMessage>;
  /** Releases runtime resources held by the child Session (e.g. its managed command sessions). Idempotent. */
  dispose(): void;
}

/**
 * Child Agent runner: injected into the `run_subagent` tool so it can
 * derive and run a child Agent without a reverse dependency on Agent/Session, avoiding circular
 * dependencies. The concrete implementation is provided by the SDK composition layer (where
 * `createAgent` lives), which internally derives via `createAgent` → `createSession` and hands
 * back a `SubagentHandle`.
 * Docs: /docs/interfaces § "Subagent interfaces".
 */
export interface SubagentRunner {
  /**
   * Derives a child Agent and creates a child Session. Precheck errors such as exceeding the
   * depth limit or a nonexistent target agent are expressed by throwing (collapsed to `failed`
   * by Environment).
   */
  spawn(input: {
    /** The child Agent's agentId; if omitted, reuses the current Agent (self-invocation). */
    agentId?: string;
    /** The Model used by the child Session; if omitted, uses the Project's default Model. */
    modelId?: string;
  }): Promise<SubagentHandle>;
}

/**
 * Proxy-reading service for describe_image: injected when the session model doesn't support
 * images (vision=false) — images are handed to the configured vision model for description and
 * the tool returns text, avoiding a 400 from feeding images back into a tool_result for a
 * provider that doesn't support images.
 * Docs: /docs/interfaces § "VisionDescriberService".
 */
export interface VisionDescriberService {
  /** Vision model id; null when the Project has no `vision_model` configured (or it's invalid), in which case the tool ends with a failed explanation. */
  modelId: string | null;
  /** Constructs a single-shot LLM for this vision model (no tools, no system prompt); omitted when `modelId` is null. */
  createLLM?: () => LLMInterface;
}

/**
 * Runtime services Environment injects into individual tools (e.g. `run_subagent` needs `SubagentRunner`); most tools don't use these.
 * Docs: /docs/interfaces § "ToolExecutionRequest and EnvironmentConfig".
 */
export interface EnvironmentServices {
  subagentRunner?: SubagentRunner;
  /** Injected when the session model doesn't support images: for describe_image's single-shot vision-model proxy reading. */
  visionDescriber?: VisionDescriberService;
  /** Registry of long-running command sessions (shared by `exec_command` / `input_command`); constructed and injected internally by Environment. */
  commandSessions?: CommandSessionManager;
  /** Registry of background subagent sessions (shared by `run_subagent` / `input_subagent`); constructed and injected internally by Environment. */
  subagentSessions?: SubagentSessionManager;
}

/** Docs: /docs/interfaces § "ToolExecutionRequest and EnvironmentConfig". */
export interface EnvironmentConfig {
  workspaceDir: string;
  toolConfig: ToolConfig;
  /** Runtime services (optional); Environment forwards these to each tool factory to use as needed. */
  services?: EnvironmentServices;
  /**
   * Agent vault environment variables (key-value pairs, taken from the Agent's
   * `agent_state/.vault.toml`): injected into the exec_command / input_command subprocess
   * environment; hardened entries cannot be overridden.
   */
  vault?: Record<string, string>;
}

/**
 * An approved tool-call execution request.
 * Docs: /docs/interfaces § "ToolExecutionRequest and EnvironmentConfig".
 */
export interface ToolExecutionRequest {
  /** The OmniMessage whose payload.type === "tool_call". */
  toolCall: OmniMessage<ToolCallPayload>;
  signal?: AbortSignal;
  /** The parent Agent's approval callback; forwarded to tools that need to derive a child Session (run_subagent), implementing approval inheritance. */
  approve?: ApproveFn;
}

/**
 * Environment interface: executes approved tool calls within the Workspace.
 * `executeTool` yields `partial_tool_call_output` as an async generator and ends with exactly one
 * complete `tool_call_output`; nested session messages carrying an origin marker (e.g. forwarded
 * by run_subagent) pass through unchanged.
 *
 * **Rendering** of tool calls is not this interface's concern (nor core's): streaming rendering is
 * handled by the CLI / Web frontend itself.
 * Docs: /docs/interfaces § "EnvironmentInterface".
 */
export interface EnvironmentInterface {
  listTools(): Promise<ToolDefinition[]>;
  executeTool(request: ToolExecutionRequest): AsyncGenerator<OmniMessage>;
  /** Looks up a tool's permission level (for frontend permission-mode decisions); returns undefined for unknown tools. */
  toolPermission(name: string): ToolPermission | undefined;
  /** Releases runtime resources held by the environment (e.g. managed long-running command sessions); called by the host when the Session ends. Optional, idempotent. */
  dispose?(): void;
}
