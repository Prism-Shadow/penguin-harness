/**
 * What the Environment side needs: the contract `context_engine` executes an approved tool
 * call through, plus the configuration and runtime services an Environment is built with.
 *
 * Two planes live in this file and must not be confused (see the docs page):
 * - the **message plane** — `executeTool`, which the engine drives: an OmniMessage tool call
 *   in, a stream of OmniMessage out, nothing else;
 * - the **management plane** — the tool list, the permission lookup, the background command
 *   and subagent listings, their stop/steer entry points and the listener attachments. These
 *   never pass through `context_engine`: they serve a host's own UI (the Web App's process
 *   and subagents panels, an approval mode's permission check) and are ordinary method calls
 *   returning ordinary data.
 *
 * Docs: packages/docs/content/interfaces.{zh,en}.md (site path /docs/interfaces).
 */
import type { OmniMessage, ToolCallPayload, ToolDefinition } from "../omnimessage/types.js";
import type { ApproveFn, RunCutoff, ThinkingLevelName } from "./shared.js";
import type { LLMInterface } from "./llm.js";
// Concrete classes, used only for EnvironmentServices type annotations (type-only import; no runtime dependency, no circular reference).
import type { CommandSessionManager } from "../environment/tools/command/session-manager.js";
import type { SubagentSessionManager } from "../environment/tools/subagent/session-manager.js";

// ---------------------------------------------------------------------------
// Tool configuration
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Subagents, services and configuration
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
   * One-shot take of the child's origin-tagged `session_meta`: a background launch
   * (run_subagent with `run_in_background`) forwards it synchronously so hosts learn of the
   * child before any collect window runs; `run` then skips its own meta forwarding. Null
   * once taken (or once `run` already sent it). Optional — older embedders' handles simply
   * leave background launches without an upfront meta.
   */
  takeMeta?(): OmniMessage | null;
  /**
   * Runs one turn of a task on the child Session. Emitted child-session messages **all already
   * carry the origin marker** (the child Session id); the first message of the first run is the
   * child Session's `session_meta`, and tool_calls received by the forwarded approval callback
   * carry origin as well. The generator's return value says whether the round was cut off
   * early (`RunCutoff`) or ran to completion (`null`) — the parent reports a cut-off round
   * as failed instead of handing the model a half answer as a result.
   */
  run(input: {
    /**
     * The round's input, in the shape `Session.run` takes a Prompt in — the same OmniMessage
     * list `steer` carries, so both ways into a child session speak one vocabulary. The
     * caller owns the messages' `sender`: the model's dispatch is `parent_agent`, a human's
     * message from a host panel carries none.
     */
    messages: OmniMessage[];
    signal?: AbortSignal;
    /** The parent Agent's approval callback; forwarded to the child Session to inherit the parent's approval mode. */
    approve?: ApproveFn;
  }): AsyncGenerator<OmniMessage, RunCutoff | null>;
  /**
   * Queues a steering message for the child Session's running Task (the same mechanism as a
   * user steering the main session: delivered as a `[user_steering]` user message at the
   * child's next input assembly). Returns false when no run is in flight — the caller then
   * falls back to a follow-up run. Optional so older embedders' handles keep compiling; a
   * handle without it simply reports "not steerable".
   */
  steer?(messages: OmniMessage[]): boolean;
  /** Pins the child Session's thinking level (`Session.thinkingLevel`: applied from its next LLM request) — a host panel's pick on a live child. Optional, like `steer`. */
  setThinkingLevel?(level: ThinkingLevelName): void;
  /** Releases runtime resources held by the child Session (e.g. its managed command sessions). Idempotent. */
  dispose(): void;
}

/** Every thinking level name, the `ThinkingLevelName` vocabulary as a runtime list (validating a wire value — the server's PATCH and Agent-config routes). */
export const THINKING_LEVEL_NAMES: readonly ThinkingLevelName[] = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

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
  /**
   * Revives a released child Session by id (`resumeSession` semantics: its own history,
   * model and Workspace) and hands back a handle for re-management — the revival path shared
   * by the host (see SubagentMessageOptions.resume) and by input_subagent on a released
   * `subagent_id`. `agentId` names the owning Agent; omitted = the parent Agent's own (a
   * self-spawn's child). A missing or unrecoverable session is expressed by throwing.
   * Optional — a runner without it simply leaves revival unavailable.
   */
  resume?(input: { agentId?: string; sessionId: string }): Promise<SubagentHandle>;
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
  /**
   * Sink for background-task completion reports (`run_in_background` launches): tools arm a
   * completion watcher that calls this when the task settles; Environment forwards it to the
   * listener the Session attached (see EnvironmentInterface.setBackgroundTaskListener).
   * Injected internally by Environment.
   */
  backgroundDone?: (event: BackgroundTaskDoneEvent) => void;
  /**
   * Live forwarding sink for background-launched subagents: the child's origin-tagged
   * messages flow here the moment its pump produces them, so hosts can stream them to the
   * frontend past the launching turn's end (display copies only — the child's own Trace is
   * the durable record). Injected internally by Environment; forwarded to the listener the
   * Session attached (see EnvironmentInterface.setBackgroundMessageListener).
   */
  backgroundForward?: (msg: OmniMessage) => void;
}

/**
 * Completion report of one background-launched task (`exec_command` / `run_subagent` with
 * `run_in_background`), emitted when the task settles and delivered to the Session as a
 * harness user message (see Session's background-notice queue).
 */
export interface BackgroundTaskDoneEvent {
  /** Which background family settled. */
  kind: "command" | "subagent";
  /** The registry handle the model holds: `process_id` or `subagent_id`. */
  id: string;
  /** What was launched: the command string, or the subagent prompt's first line (display only, truncated by the producer). */
  label: string;
  /**
   * Terminal status of the run. `stopped` is a command somebody ended on purpose (a stop
   * signal from outside, a capacity eviction) — settled, but not a failure to react to;
   * `failed` stays for outcomes nobody asked for (a spawn error, a non-zero exit, a fault
   * signal).
   */
  status: "completed" | "failed" | "stopped";
  /** One-line terminal detail (exit code / signal / subagent note); empty when there is none. */
  detail: string;
  /** Tail of the yet-undelivered output at settle time (capped by the producer); empty when nothing was pending. */
  output: string;
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
  /**
   * Harness-control variables for exec_command / input_command subprocess environments
   * (see {@link CreateAgentOptions.controlEnv}): the hosting server injects its own API
   * address, its local API token and this Session's coordinates so commands the Agent
   * runs can drive the harness back through the CLI/API. Re-read at every spawn like
   * `proxyEnv`. These entries override vault entries of the same name (sanctioned host
   * wiring outranks per-Agent variables) but never the hardened entries. Absent = nothing
   * is injected (SDK/CLI standalone use).
   */
  controlEnv?: () => Record<string, string>;
  /**
   * Sandbox-confinement seam for exec_command / input_command subprocesses (see
   * {@link SpawnConfiner}). Like {@link EnvironmentConfig.proxyEnv} it is a getter
   * re-read at every spawn, so the hosting server can change the active confiner at
   * runtime (e.g. via a platform hot push) and reach Sessions that are already
   * running. Absent, or a getter returning null = commands spawn unconfined (the
   * default for SDK/CLI standalone use).
   */
  confineSpawn?: () => SpawnConfiner | null;
  /**
   * Tool factories the host adds, by tool name, consulted before the built-in registry
   * for every `toolConfig.customTools` entry (see core `AgentAssembly`). A name found
   * neither here nor built in is skipped, as before.
   */
  toolFactories?: Readonly<Record<string, ToolFactoryLike>>;
}

/** A builtin-tool factory as the environment layer sees it (the concrete type lives in environment/tools/registry). */
export type ToolFactoryLike = (
  definition: ToolDefinitionConfig,
  services?: EnvironmentServices,
) => unknown;

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
 * Rewrites the exact argv a command session is about to spawn so it executes
 * confined — typically the original invocation wrapped in a sandbox runner
 * (`[runner, ...profileArgs, "--", ...argv]`). Mechanism only: which confinement
 * policy applies, and which backend enforces it, is decided by whoever supplies
 * the confiner (the hosting server's platform layer); this seam never interprets
 * the argv. Fail-closed by contract: a confiner that cannot enforce its policy
 * must THROW — the error surfaces as the command's spawn failure instead of the
 * command running unconfined. Returning the argv unchanged is reserved for
 * policies that genuinely mean "unconfined".
 * @param argv - the exact argv about to be spawned (`[shellCommand, ...shellArgs, cmd]`), not a shell string.
 * @param opts - spawn context: `cwd` is the working directory of THIS command (per-call,
 *   may differ from the workspace); `workspaceDir` is the Session's Workspace root — the
 *   directory a workspace-scoped confinement policy should treat as writable, never
 *   inferred from `cwd` (a command may run in a workdir outside the Workspace).
 * @returns the argv to spawn instead.
 */
export type SpawnConfiner = (
  argv: readonly string[],
  opts: { cwd: string; workspaceDir: string },
) => readonly string[];

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
  /**
   * The service the process serves, when one was detected: the last local URL its output
   * printed (may carry a path), else `http://localhost:<port>` synthesized from a listen-port
   * probe of its process group (refresh via `probeBackgroundCommandServices`). Absent when
   * neither source has one.
   */
  serviceUrl?: string;
}

/**
 * One live subagent child session owned by the environment: the child Session id (the origin
 * hop the frontend already correlates by), the registry handle when the session was promoted
 * to the background (null while it only lives inside a foreground collect window), and
 * whether a round is currently running.
 */
export interface BackgroundSubagentInfo {
  sessionId: string;
  subagentId: string | null;
  running: boolean;
}

/**
 * Outcome of a host-initiated subagent message (`sendToBackgroundSubagent`): `steered` = the
 * child was mid-run and the text was queued as a steering message; `started` = the child was
 * idle and the text began a follow-up run on the same child Session; `resumed` = no live
 * child bore the id, so the session was revived through `SubagentRunner.resume` and the text
 * began its next round; `busy` = the child cannot take the message right now (mid-run on a
 * handle that predates steering, or no room to re-manage a resumed session); `gone` = no
 * live child and no way to resume (resume not requested/available, or the session's record
 * is unrecoverable).
 */
export type SubagentMessageOutcome = "steered" | "started" | "resumed" | "busy" | "gone";

/** Options of a host-initiated subagent message (see EnvironmentInterface.sendToBackgroundSubagent). */
export interface SubagentMessageOptions {
  /**
   * Enables the resume fallback when no live child bears the session id: the child Session
   * is revived (its own history, model and Workspace — `resumeSession` semantics) and
   * re-managed, and the text starts its next round. `agentId` names the Agent that owns the
   * child session (the host reads it from its session registry).
   */
  resume?: { agentId: string };
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
  /**
   * Whether a background subagent session is mid-round. Hosts pin a Session's runtime entry
   * on it: a `run_in_background` child outlives the call that launched it, and evicting the
   * Session while it works strands its completion report and live messages. Optional, like
   * listBackgroundCommands.
   */
  hasRunningBackgroundSubagents?(): boolean;
  /**
   * All live subagent child sessions (foreground-window ones included), for a host UI's
   * subagents panel. Optional, like listBackgroundCommands.
   */
  listBackgroundSubagents?(): BackgroundSubagentInfo[];
  /**
   * Host-initiated message to one child session, by child Session id: steering while the
   * child runs, a follow-up run while it is idle, a revival (`opts.resume`) when the session
   * is no longer live (see SubagentMessageOutcome/SubagentMessageOptions). The human and the
   * model (`input_subagent`) converge on the managed session's same channel, and both hand
   * it the same thing — an OmniMessage list, whichever state the child is in. Optional.
   */
  sendToBackgroundSubagent?(
    childSessionId: string,
    messages: OmniMessage[],
    opts?: SubagentMessageOptions,
  ): Promise<SubagentMessageOutcome>;
  /**
   * Host-initiated abort of one child session's CURRENT run (the child-session equivalent of
   * the user's stop button): the session survives for follow-ups — a subagent session is
   * never destroyed. False when the child is unknown or idle. Optional.
   */
  abortBackgroundSubagentRun?(childSessionId: string): boolean;
  /**
   * Host-initiated pin of one live child session's thinking level (the child-session
   * equivalent of assigning `Session.thinkingLevel`: applied from the child's next LLM
   * request). False when the child is not live — a released child is revived through the
   * host's loader, which restores the pin it stores. Optional.
   */
  setBackgroundSubagentThinkingLevel?(childSessionId: string, level: ThinkingLevelName): boolean;
  /**
   * Attaches the single listener for subagent run-state changes (a round starting or
   * settling on any live child). The host re-reads `listBackgroundSubagents` on each ping —
   * the event carries no payload, so state reads stay race-free against the listing.
   * Optional, same single-listener pattern as setBackgroundTaskListener.
   */
  setSubagentStateListener?(listener: () => void): void;
  /**
   * Attaches the host's session-lifetime fallback approval sink for child sessions: a child
   * approval with no window sink (an active run_subagent/input_subagent call) and no
   * background-launch standing sink is consulted through this instead of waiting for the
   * model's next poll — the host escalates it to the user, the parent session idle included.
   * Window sinks and standing sinks keep precedence while present. Optional: hosts that
   * never attach one (e.g. the CLI) keep the poll-window-only approval semantics.
   */
  setSubagentApprovalFallback?(approve: ApproveFn): void;
  /**
   * Refreshes the listen-port probe behind `BackgroundCommandInfo.serviceUrl` for running
   * sessions whose output printed no URL (TTL-cached and time-bounded per session; see
   * command/port-probe.ts). Hosts call it before reading the list when they want probed
   * URLs; the list itself stays synchronous. Optional, like listBackgroundCommands.
   */
  probeBackgroundCommandServices?(): Promise<void>;
  /**
   * Attaches the single listener for background-task completion reports (`run_in_background`
   * launches). Events fired before a listener exists are buffered and flushed on attach; after
   * `dispose()` no further events fire. Optional — environments without background tools omit it.
   */
  setBackgroundTaskListener?(listener: (event: BackgroundTaskDoneEvent) => void): void;
  /**
   * Attaches the single listener for live-forwarded background-subagent messages (see
   * EnvironmentServices.backgroundForward). Same buffering and dispose semantics as
   * setBackgroundTaskListener. Optional.
   */
  setBackgroundMessageListener?(listener: (msg: OmniMessage) => void): void;
  /** Releases runtime resources held by the environment (e.g. managed long-running command sessions); called by the host when the Session ends. Optional, idempotent. */
  dispose?(): void;
}
