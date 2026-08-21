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

// ToolDefinition is defined in omnimessage/types.ts (the tool_list_ready event carries the full tool schema); re-exported here to keep the original import path.
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
  /**
   * Per-tool toggle for the optional `description` call argument (a model-written sentence
   * shown to the user while the call runs). The argument itself is declared as a normal
   * property in this entry's `parameters` (editable config is the single source of truth);
   * setting `call_description: false` filters that property out of the schema handed to the
   * LLM at assembly time (in-memory only — the stored YAML is never rewritten). Missing =
   * true (the property stays). No effect on entries whose parameters declare no
   * `description` property.
   */
  call_description?: boolean;
}

/**
 * One MCP Server entry from `system_config.yaml` (`tools.mcpServers`). `name` scopes the
 * server's tools as `mcp__<name>__<tool>`; `config` stays an open object at this seam (the
 * stored YAML is schema-free) and is typed/validated at Environment assembly time by
 * `environment/mcp/config.ts`: `transport: "stdio" | "http" | "sse"` (inferable from
 * `command` / `url`), the per-transport fields (stdio: `command`/`args`/`env`/`cwd`;
 * http/sse: `url`/`headers`), and the shared optional `connectTimeoutMs` / `timeoutMs` /
 * `maxOutputLength`.
 * Docs: /docs/tools § "MCP servers".
 */
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

export type ThinkingLevelName = "none" | "low" | "medium" | "high" | "xhigh" | "max";

/**
 * GenerativeModel initialization config.
 * Docs: /docs/interfaces § "GenerativeModelConfig".
 */
export interface GenerativeModelConfig {
  modelId: string;
  apiKey?: string;
  baseUrl?: string;
  /**
   * AgentHub client protocol (`openai-chat` / `openai-responses` / `claude-4-8` /
   * `deepseek-v4` / …; the bare `openai` spelling is a deprecated alias of `openai-chat`). If
   * omitted, AgentHub infers it from `modelId`; custom-named models or third-party models
   * using an OpenAI protocol must specify it explicitly.
   */
  clientType?: string;
  tools: ToolDefinition[];
  /** Full system Prompt after placeholder substitution in the system_config.system_prompt template. */
  systemPrompt?: string;
  /**
   * Model context window (tokens, from the model entry). Used to clamp each request's
   * effective output cap so `input + max_tokens` stays inside the window (issue #218).
   * Unset (or implausibly small, see llm/context-limits.ts resolveContextWindow): the
   * clamp is disabled — a hard cap is never derived from an assumed window.
   */
  contextWindow?: number;
  /**
   * Output token cap per Request; non-positive (-1) means no explicit cap (omitted from the
   * request). With `contextWindow` set, a positive cap is a ceiling, not a constant: each
   * request sends `min(maxTokens, contextWindow − estimated input − safety margin)` (see
   * llm/context-limits.ts) so small-window models never fail provider validation.
   */
  maxTokens?: number;
  /**
   * Per-model fast mode (from the model entry's `fast_mode` annotation): when true, every
   * request opts into the provider's faster serving tier at premium pricing (AgentHub
   * UniConfig `fast_mode`). Off by default. Models without a fast tier reject the parameter
   * before any network I/O (AgentHub `UnsupportedParameterError`); `streamGenerate` reports
   * that as a permanent `failed` outcome so the engine surfaces it instead of retrying.
   */
  fastMode?: boolean;
  /** Construction-time default thinking level; a per-request `GenerativeModelParameters.thinkingLevel` overrides it for that request. */
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
  /**
   * Per-request thinking level override: applied to **this request only**; omitted falls back
   * to the construction-time default (`GenerativeModelConfig.thinkingLevel`). The thinking
   * level is a per-turn parameter, not a Session invariant.
   */
  thinkingLevel?: ThinkingLevelName;
}

/**
 * The terminal state of an LLM request, returned as the **return value** of the `streamGenerate`
 * async generator (not a yielded message). The status values share the same six-value protocol
 * as OmniMessage `stop_reason`:
 *   - `completed`: finished normally (already produced `token_usage`);
 *   - `timeout`: LLM timed out or lost connection, needs reconnect — retried by `context_engine`
 *     within the same run;
 *   - `malformed`: AgentHub response failed JSON parsing, needs reconnect — also retried by
 *     `context_engine`;
 *   - `aborted`: user-initiated interruption — stop and hand back to the user;
 *   - `failed`: an error the retry classifier did not judge transient (params, etc.) — still
 *     retried by `context_engine` within the same run (`errorMessage` provides the display text).
 *     The classification stays honest — this is reported as `failed`, not relabelled a
 *     timeout — while the *policy* retries it, because that classifier is an allowlist and a
 *     gateway phrasing a transient fault its own way lands here;
 *   - `auth`: the provider rejected the credentials (see `isAuthenticationError`) — the one
 *     status that stops the run outright, since no retry can turn a rejected credential into
 *     a working one; hosts also key on it to disable input until the model's API key is
 *     updated (only the model reference is fixed at Session creation; credentials come from
 *     the current Project config, so a key update lets the Session continue).
 * Docs: /docs/interfaces § "LLMOutcome semantics".
 */
export interface LLMOutcome {
  status: StopReason;
  /**
   * Error detail (`describeError` text): present on `failed` / `auth`, and on `timeout` /
   * `malformed` when a concrete transport/provider error was caught (a plain idle timeout
   * has none). Carried onto the `request_end` event as `error_message` — one name across
   * the internal outcome and the wire — so observability (the Cost center's errors panel)
   * can show the real reason behind a retried request.
   */
  errorMessage?: string;
  /**
   * Marks a `failed` outcome as deterministic: a client-side rejection thrown before any
   * network I/O (currently AgentHub's `UnsupportedParameterError` for `fast_mode` on a model
   * without a fast tier), which the identical request can never retry into working. The
   * engine skips the reconnect ladder for it and aborts the run with `errorMessage` — the
   * same terminal handling as `auth`, but the fix is a config change (turn off fast mode for
   * the model), not a credential update, so it stays a `failed` and hosts don't gate input.
   */
  permanent?: boolean;
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
 * Thinking levels the model may request for a spawned child Session (`run_subagent`'s
 * `thinking_level` argument): the selectable tiers only — never `"none"`, mirroring the
 * user-facing pickers (many models cannot disable thinking; see the web picker's
 * SELECTABLE_THINKING_LEVELS and project-config's DEFAULT_CHAT_THINKING_LEVELS). Omitting the
 * argument inherits the parent Session's effective level, so a parent genuinely running
 * without a level still passes that down.
 */
export const SUBAGENT_THINKING_LEVELS: readonly ThinkingLevelName[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

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
    /**
     * Upstream model id for the child Session, paired with `provider` — a model reference is
     * always the complete pair. Omit both to inherit the parent Session's model; supplying
     * one half without the other is rejected.
     */
    modelId?: string;
    /** Provider group for `modelId`; required whenever `modelId` is given. */
    provider?: string;
    /**
     * Explicit thinking level for the child Session; omitted inherits the parent Session's
     * effective level (including "no level" when the parent has none). The `run_subagent`
     * tool restricts its `thinking_level` argument to {@link SUBAGENT_THINKING_LEVELS}.
     */
    thinkingLevel?: ThinkingLevelName;
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

/** Fetch contract injected into the native web_search tool for host overrides and offline tests. */
export type WebSearchFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

/** Runtime configuration for native web search; SearXNG is the default provider. */
export interface WebSearchService {
  /** SearXNG base URL; defaults to SEARXNG_ENDPOINT from the Agent vault/process, then http://127.0.0.1:8080. */
  endpoint?: string;
  /** Optional fetch override; normal runtimes use globalThis.fetch. */
  fetch?: WebSearchFetch;
}

/**
 * Runtime services Environment injects into individual tools (e.g. `run_subagent` needs `SubagentRunner`); most tools don't use these.
 * Docs: /docs/interfaces § "ToolExecutionRequest and EnvironmentConfig".
 */
export interface EnvironmentServices {
  subagentRunner?: SubagentRunner;
  /** Injected when the session model doesn't support images: for describe_image's single-shot vision-model proxy reading. */
  visionDescriber?: VisionDescriberService;
  /** Native web-search provider override; Environment fills its endpoint from the Agent vault/process when omitted. */
  webSearch?: WebSearchService;
  /** Registry of long-running command sessions (shared by `exec_command` / `input_command`); constructed and injected internally by Environment. */
  commandSessions?: CommandSessionManager;
  /** Registry of background subagent sessions (shared by `run_subagent` / `input_subagent`); constructed and injected internally by Environment. */
  subagentSessions?: SubagentSessionManager;
}

/** Docs: /docs/interfaces § "ToolExecutionRequest and EnvironmentConfig". */
export interface EnvironmentConfig {
  workspaceDir: string;
  toolConfig: ToolConfig;
  /**
   * This Session's private scratchpad directory (`scratchpad/<sessionId>`), the generic
   * Session-scoped storage root for Environment by-products. Currently it backs
   * truncated-tool-output recovery: output beyond an entry's `maxOutputLength` is saved under
   * `<sessionScratchpadDir>/truncated-tool-output/`. Agent Sessions always pass it; standalone
   * embedders without a stable Session directory omit it and keep truncation-only behavior.
   */
  sessionScratchpadDir?: string;
  /** Runtime services (optional); Environment forwards these to each tool factory to use as needed. */
  services?: EnvironmentServices;
  /**
   * Agent vault environment variables (key-value pairs, taken from the Agent's
   * `agent_state/.vault.toml`): injected into the exec_command / input_command subprocess
   * environment; hardened entries cannot be overridden.
   */
  vault?: Record<string, string>;
  /**
   * Proxy policy for exec_command / input_command subprocess environments (see
   * {@link ProxyEnvPolicy}). Threaded by the Web server from its admin-level proxy
   * settings; re-read at every spawn so a settings change needs no restart. Absent, or a
   * getter returning null = the host environment passes through unchanged (the default
   * for SDK/CLI standalone use).
   */
  proxyEnv?: () => ProxyEnvPolicy | null;
}

/**
 * Proxy policy applied to command subprocess environments (see
 * {@link EnvironmentConfig.proxyEnv}):
 * - `{ mode: "strip" }` — the proxy variables (HTTP_PROXY / HTTPS_PROXY / ALL_PROXY, any
 *   casing) are removed; NO_PROXY is kept (inert without them, and commands that set
 *   their own proxy still honor it). The hosting server's proxy switch in the off state.
 * - `{ mode: "inject", url, noProxy }` — the explicit proxy wins over ambient env:
 *   HTTP_PROXY / HTTPS_PROXY (plus their lowercase twins) are set to `url` and
 *   NO_PROXY / no_proxy to `noProxy`, overriding inherited values; an inherited
 *   ALL_PROXY (any casing) is removed for the same reason. The caller supplies `noProxy`
 *   pre-merged (the hosting server includes the loopback names).
 * - `null` (or no getter at all) — pass through unchanged.
 * The Agent vault still overrides whichever of these the policy produced: a per-Agent
 * explicit variable outranks the host-level policy.
 */
export type ProxyEnvPolicy = { mode: "strip" } | { mode: "inject"; url: string; noProxy: string };

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
 * One background command process owned by the environment (an exec_command promoted past
 * its yield window): the registry handle plus display metadata for a host UI's process
 * list. `pid` is the shell leading the process group (null when the spawn itself failed);
 * `startedAt` is epoch milliseconds.
 */
export interface BackgroundCommandInfo {
  processId: string;
  pid: number | null;
  cmd: string;
  cwd: string;
  startedAt: number;
  running: boolean;
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
  /** Background command processes this environment currently owns (host UI process list). Optional — standalone embedders may not track any. */
  listBackgroundCommands?(): BackgroundCommandInfo[];
  /** Kills one background command process by id (whole process group); false when the id is unknown. Optional, like listBackgroundCommands. */
  killBackgroundCommand?(processId: string): boolean;
  /** Releases runtime resources held by the environment (e.g. managed long-running command sessions); called by the host when the Session ends. Optional, idempotent. */
  dispose?(): void;
}
