/**
 * Agent and the `createAgent` entry point.
 *
 * `createAgent` is the unified way to create/load an Agent: it initializes Agent State
 * if the directory is empty, otherwise loads by agentId.
 * An Agent has exactly one Agent State and can run multiple times; the
 * Workspace is determined when a Session is created.
 *
 * A Session runs on **model contexts**, each assembled from the Agent State as it is on disk
 * the moment the context opens — Session creation, the context a completed compaction opens,
 * a resume that finds its context closed — and fixed until the context closes (see
 * `assembleContext`). The Agent object's own `state` is the load-time snapshot, used for
 * identity and initialization; no Session runs on it.
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  assertValidId,
  assembleSystemPrompt,
  buildToolConfig,
  selectBuiltinToolsForModel,
  DEFAULT_COMPACTION_PROMPT,
  DEFAULT_MAX_CONTEXT_LENGTH,
  formatModelRef,
  getModel,
  listInstalledSkills,
  listScheduleNames,
  loadAgentState,
  loadAgentVault,
  loadProjectConfig,
  listInstalledHooks,
  projectDir,
  resolveSessionMemory,
  resolveModelRef,
  sessionScratchpadDir,
  systemConfigPath,
  tracesDir,
  type AgentState,
  type ModelRef,
  type ProjectConfig,
} from "./state/index.js";
import { GenerativeModel, ToolCallIdAllocator, effectiveMaxContextLength } from "./llm/index.js";
import { Environment } from "./environment/index.js";
import {
  Writer,
  findLatestTraceFile,
  latestSessionId as latestTraceSessionId,
  readTraceTolerant,
  resumeTrace,
} from "./trace/index.js";
import { Session } from "./session.js";
import { scriptPreToolUseHook, scriptStopHook, scriptUserPromptHook } from "./hooks/script-hook.js";
import type { HookSubagentRequest, SessionHooks } from "./hooks/stop-hook.js";
import { hookPackageEnabled } from "./plugins/index.js";
import type { SessionConfig } from "./session.js";
import {
  createTempWorkspace,
  formatSessionId,
  mcpConnectOutcome,
  sessionEnvironment,
} from "./internal/session-support.js";
import {
  compactionEnd,
  mcpConnectBegin,
  mcpConnectEnd,
  sessionMeta,
  toolListReady,
  userText,
  withOrigin,
} from "./omnimessage/index.js";
import type {
  MessageOrigin,
  OmniMessage,
  SessionMetaPayload,
  ToolCallPayload,
} from "./omnimessage/index.js";
import { SUBAGENT_NAME } from "./environment/tools/run-subagent.js";
import { INPUT_SUBAGENT_NAME } from "./environment/tools/input-subagent.js";
import type {
  CompactionSettings,
  OpenContextOptions,
  OpenedContext,
} from "./engine/context-engine.js";
import type {
  ApproveFn,
  CommandPolicyConfig,
  GenerativeModelConfig,
  ProxyEnvPolicy,
  SubagentHandle,
  SubagentRunner,
  ThinkingLevelName,
  ToolConfig,
  ToolDefinition,
  VisionDescriberService,
} from "./interfaces/index.js";
import type { ModelEntry } from "./state/index.js";

/**
 * Maximum subagent spawn depth. Currently capped at 1 level (a subagent cannot spawn
 * another subagent); the depth mechanism is designed to support multiple levels —
 * raise this constant to allow deeper nesting.
 */
const MAX_SUBAGENT_DEPTH = 1;

export interface CreateAgentOptions {
  agentId?: string;
  projectId?: string;
  /** Local data root directory; defaults to `resolveRoot()` (PENGUIN_HOME or ~/.penguin/data). */
  root?: string;
  /**
   * Proxy policy for exec_command subprocess environments of every Session this Agent
   * creates or resumes — and of its subagents' Sessions, which inherit the getter (see
   * {@link ProxyEnvPolicy}: strip the proxy variables, inject an explicit proxy over the
   * inherited env, or null = pass through). The Web server threads its admin-level proxy
   * settings through here; the getter is re-read at every command spawn, so a settings
   * change needs no restart. Absent = pass through (SDK/CLI standalone use follows the
   * user's own shell environment).
   */
  proxyEnv?: () => ProxyEnvPolicy | null;
  /**
   * Harness-control variables for the command subprocesses of every Session this Agent
   * creates or resumes. The hosting server passes a policy getter here; core evaluates it
   * with each Session's own coordinates (subagent Sessions get their own agent/session
   * ids — a child Agent inherits the getter like `proxyEnv`, and its Sessions call it with
   * their own context). The returned entries override vault entries of the same name (see
   * {@link EnvironmentConfig.controlEnv}). Absent = nothing is injected (SDK/CLI
   * standalone use).
   */
  controlEnv?: (ctx: ControlEnvContext) => Record<string, string>;
}

/** The Session coordinates a {@link CreateAgentOptions.controlEnv} policy is evaluated with. */
export interface ControlEnvContext {
  projectId: string;
  agentId: string;
  sessionId: string;
}

export interface CreateSessionOptions {
  /** Workspace for this run; if unspecified, a temporary Workspace is created under the Agent directory. */
  workspaceDir?: string;
  /**
   * Model used for this Session (upstream model_id); must be given together with `provider`.
   * Omit both to use the Project's default Model.
   */
  modelId?: string;
  /**
   * Provider grouping for `modelId`: the two together form the paired reference. It is never
   * inferred, so it's "both or neither" — either half alone is an error, not a lookup.
   */
  provider?: string;
  /**
   * Thinking level for this Session — a tri-state:
   * - a `ThinkingLevelName` pins the level;
   * - `undefined` (omitted) falls back to the config chain: the Agent's explicit
   *   `model.thinking_level` > the Project's `default_chat.thinking_level` > the built-in
   *   `"medium"` (see `configuredThinkingLevel`), read again for every model context the
   *   Session opens;
   * - `null` means "no thinking level": the config fallback is suppressed entirely
   *   (nothing goes into the LLM config).
   * Subagent spawning passes the parent Session's effective level (its level, or `null`
   * when the parent has none) unless the spawn requests an explicit level (`run_subagent`'s
   * `thinking_level`) — either way a child Session never falls back to the child Agent's
   * own config.
   */
  thinkingLevel?: ThinkingLevelName | null;
  /** Explicit credentials; if unspecified, falls back to credentials in the Project config, then to AgentHub reading environment variables. */
  apiKey?: string;
  baseUrl?: string;
  /** Internal use: this Session's depth in the subagent spawn chain (0 at the top level), used to cap spawn depth. */
  subagentDepth?: number;
  /** Session origin recorded in session_meta (absent = user-created); the subagent spawn site passes "subagent", callers driven by a scheduled task pass "schedule". */
  source?: "subagent" | "schedule";
}

export interface ResumeSessionOptions {
  /** Id of the Session to resume. */
  sessionId: string;
  /** Explicit credentials; if unspecified, falls back to credentials in the Project config, then to AgentHub reading environment variables. */
  apiKey?: string;
  baseUrl?: string;
}

/**
 * The facts fixed for a Session's lifetime — every model context of the Session is opened
 * against them. Everything else a context runs with comes from the Agent State as it is on
 * disk when the context opens (see `Agent.assembleContext`).
 */
interface SessionSpec {
  sessionId: string;
  workspaceDir: string;
  /** The Session's model entry as resolved from the Project config at creation (or recorded at resume): reference, credentials, window and per-model annotations. */
  modelEntry: ModelEntry;
  apiKey: string | undefined;
  baseUrl: string | undefined;
  /**
   * The Session's thinking-level pin, the tri-state of {@link CreateSessionOptions.thinkingLevel}:
   * a value pins every context opened from now on; `null` runs them without a level;
   * `undefined` reads the Agent config's default when each context opens. Fixed at
   * creation: a mid-session change (`Session.thinkingLevel`) is engine state — it rides
   * requests but reshapes no context and never lands here.
   */
  thinkingLevel: ThinkingLevelName | null | undefined;
  subagentDepth: number;
  source?: "subagent" | "schedule";
}

/**
 * A Session's runtime components, assembled once by `buildRuntime` (shared by createSession
 * and resumeSession) around the context the Session starts in.
 */
interface SessionRuntime {
  /** Session-lifetime Environment, equipped with the initial context's toolset and vault (a later context re-equips it — see openNextContext). */
  environment: Environment;
  /**
   * Opens the Session's FIRST context, lazily at the start of the first run: resolves the
   * toolset (the Environment's first listTools connects any configured MCP Servers,
   * published through `opts.emit` as the connect pair, then the toolset record) and builds
   * that context's LLM object. Kept out of createSession on purpose — Session creation
   * stays instant and the records stream on the run. The same opening procedure as
   * `openNextContext`: only what is being opened differs.
   */
  bootstrap: (opts: OpenContextOptions) => Promise<{ llm: GenerativeModel }>;
  /**
   * Opens the context that follows a completed compaction (see ContextEngineDeps.openNextContext):
   * the whole configuration assembled anew from the Agent State, the Environment re-equipped
   * with it, then the same opening procedure as `bootstrap` — and the session_meta recording
   * the context alongside its engine settings.
   */
  openNextContext: (opts: OpenContextOptions) => Promise<OpenedContext>;
  /** The running context's command policy — follows the rotation (see SessionConfig.commandPolicy). */
  commandPolicy: () => CommandPolicyConfig | undefined;

  createBareLLM: () => GenerativeModel;
  /** The child-session runner the run_subagent tool uses; sessionHooks' subagent spawner shares it. */
  subagentRunner: SubagentRunner;
}

/**
 * What one model context runs with, assembled from the Agent State as it was on disk at the
 * moment the context opened; immutable for the context's lifetime.
 */
interface AssembledContext {
  systemPrompt: string;
  /** The vault's values, for the Environment's command subprocesses; only the key names enter the prompt. */
  vault: Record<string, string>;
  toolConfig: ToolConfig;
  /** The Project's command policy as read when this context opened (`[command_policy]` of `.project_config.toml`) — Project-owned rather than Agent State, rotated on the same strict-tier schedule. */
  commandPolicy: CommandPolicyConfig | undefined;
  /** The context's effective thinking level: the Session's pin, or the config default read now. */
  thinkingLevel: ThinkingLevelName | undefined;
  maxTokens: number | undefined;
  requestTimeoutMs: number | undefined;
  /** `system_config.max_turns`; the engine treats absent as unlimited (-1). */
  maxTurns: number | undefined;
  compaction: CompactionSettings;
  /** The session_meta describing this context: the prompt it runs with, and the Session-fixed facts. */
  meta: SessionMetaPayload;
}

// Compaction-threshold derivation (`effectiveMaxContextLength`) lives with the rest of the
// window arithmetic in llm/context-limits.ts; re-exported by llm/index.js.

/**
 * Output cap for meta requests (title generation / vision describing): these carry their own
 * small hardcoded budget, tightened further by the entry's per-model `max_tokens` when that is
 * smaller — a cap the user pinned below the budget must bind every request to that model. The
 * budget is never raised. A non-positive cap (-1 = uncapped) never tightens: Math.min against
 * it would send max_tokens -1 on the wire, and meta requests must keep their small budget.
 */
export function metaMaxTokens(budget: number, modelCap: number | undefined): number {
  return modelCap !== undefined && modelCap > 0 ? Math.min(budget, modelCap) : budget;
}

/** Create or load an Agent (the one init-enabled use of `loadAgentState`). */
export async function createAgent(opts: CreateAgentOptions = {}): Promise<Agent> {
  const state = await loadAgentState({
    ...(opts.agentId !== undefined ? { agentId: opts.agentId } : {}),
    ...(opts.projectId !== undefined ? { projectId: opts.projectId } : {}),
    ...(opts.root !== undefined ? { root: opts.root } : {}),
    init: {},
  });
  const projectConfig = await loadProjectConfig(state.root, state.projectId);
  return new Agent(state, projectConfig, opts.proxyEnv, opts.controlEnv);
}

export class Agent {
  constructor(
    readonly state: AgentState,
    readonly projectConfig: ProjectConfig,
    /** See {@link CreateAgentOptions.proxyEnv}; forwarded into every Session's Environment. */
    private readonly proxyEnv?: () => ProxyEnvPolicy | null,
    /** See {@link CreateAgentOptions.controlEnv}; evaluated per Session with that Session's coordinates. */
    private readonly controlEnv?: (ctx: ControlEnvContext) => Record<string, string>,
  ) {}

  /**
   * A Session's default thinking level when no explicit per-session level is given — the
   * resolution chain (the single rule, keep both sites on it): the Agent's explicit
   * `model.thinking_level` > the Project's `default_chat.thinking_level` > the built-in
   * `"medium"` (the documented Agent default). Read against the Agent State and the Project
   * config a context is assembled from, so the default follows both files into each new
   * context. Mirrored by
   * the web draft picker's DISPLAY (web features/chat/thinking-level.ts
   * `effectiveThinkingLevel`): the picker shows this effective value, and a pick writes
   * through to the AGENT config — the project default is only ever a fallback, never
   * overwritten from there.
   */
  private configuredThinkingLevel(
    state: AgentState,
    projectConfig: ProjectConfig,
  ): ThinkingLevelName {
    return (
      state.systemConfig.model?.thinking_level ??
      projectConfig.default_chat?.thinking_level ??
      "medium"
    );
  }

  /**
   * Assembles what a model context runs with, from the Agent State as it is on disk **now**:
   * `system_config.yaml` in full — the prompt template with its section prompts and toggles,
   * the builtin tool entries and MCP Servers, the compaction settings, `max_turns`, the
   * model defaults — plus `AGENTS.md`, the vault, the installed Skills' metadata, the Memory
   * indexes, the schedule roster and the Environment values (the date included). Every
   * context opener goes through here — createSession, the context a completed compaction
   * opens (buildRuntime's openNextContext) and a resume that finds its context closed — so an
   * edit made during one context, by the user or by the model working on its own
   * configuration, lands in the next context and never in the one that is running. What
   * stays fixed is the Session itself (`spec`): id, Workspace, model entry, origin, depth and
   * the thinking-level pin.
   *
   * The vault's values go to the Environment's command subprocesses and only its **key
   * names** enter the prompt (so the model knows which API keys are available); Skills only
   * inject metadata (name and description) and the model reads the body on demand via shell;
   * Memory likewise injects only its index; Schedules inject only task names.
   *
   * `systemPrompt`, when given, is used instead of assembling it: a
   * resume of an open context keeps the prompt its Trace recorded, since the history
   * replayed into it was produced under that request prefix.
   * Docs: /docs/agent-loop § "Compaction".
   */
  private async assembleContext(
    spec: SessionSpec,
    opts: { systemPrompt?: string } = {},
  ): Promise<AssembledContext> {
    const { root, projectId, agentId } = this.state;
    const state = await loadAgentState({ root, projectId, agentId });
    const vault = await loadAgentVault(root, projectId, agentId);
    // Strict-tier alongside the Agent State even though it is Project-owned: the command
    // policy this context runs under (and the Project half of the thinking-level chain) is
    // the one on disk at its open.
    const projectConfig = await loadProjectConfig(root, projectId);
    const commandPolicy = projectConfig.command_policy;
    let systemPrompt = opts.systemPrompt;
    if (systemPrompt === undefined) {
      const installedSkills = await listInstalledSkills(root, projectId, agentId);
      // Schedule task names for the {{SCHEDULES}} roster (names only; the files' contents are
      // the server-side scheduler's concern).
      const scheduleNames = await listScheduleNames(root, projectId, agentId);
      // Memory for this Session: null when the Agent has Memory off; a temporary Workspace
      // gets the user scope only (nothing written against it could ever be read back).
      const memory = await resolveSessionMemory({
        root,
        projectId,
        agentId,
        workspaceDir: spec.workspaceDir,
        enabled: state.systemConfig.memory?.enabled !== false,
      });
      systemPrompt = assembleSystemPrompt(
        state,
        sessionEnvironment(spec.workspaceDir, spec.sessionId, {
          agentId,
          projectDir: projectDir(root, projectId),
          provider: spec.modelEntry.provider,
          modelId: spec.modelEntry.model_id,
        }),
        Object.keys(vault),
        installedSkills,
        memory,
        scheduleNames,
      );
    }

    // Tool exposure is capped by depth: a (leaf) child Agent that has reached the max spawn
    // depth no longer gets run_subagent or input_subagent (the latter depends on the
    // subagent_id produced by the former, so exposing it alone is meaningless). Tool entries
    // are also selected by the session model's type (marked via forModel: vision models use
    // read_image, text-only models use describe_image; entries without this marker are
    // unaffected).
    const canSpawn = spec.subagentDepth < MAX_SUBAGENT_DEPTH;
    const baseToolConfig = buildToolConfig(state);
    const modelVision = spec.modelEntry.vision !== false;
    let customTools = selectBuiltinToolsForModel(baseToolConfig.customTools, modelVision);
    if (!canSpawn) {
      customTools = customTools.filter(
        (d) =>
          d.name !== SUBAGENT_NAME &&
          d.name !== INPUT_SUBAGENT_NAME &&
          // Legacy entry still present in stale stored configs; the registry no longer
          // assembles it, this just keeps the leaf filter symmetrical.
          d.name !== "kill_subagent",
      );
    }
    const toolConfig: ToolConfig = { ...baseToolConfig, customTools };

    // The context's base thinking level — the Session's tri-state pin: a value wins over
    // every config; `null` — how subagent spawning says "the parent has none" — suppresses
    // the config fallback entirely; only `undefined` (no pin) reads the config chain,
    // against this context's State (Agent explicit > Project default_chat > built-in
    // "medium", see configuredThinkingLevel). A per-request parameter, not part of the
    // prefix: this is only the base the Session's live pin overrides, and nothing records it.
    const pin = spec.thinkingLevel;
    const thinkingLevel =
      pin === null ? undefined : (pin ?? this.configuredThinkingLevel(state, projectConfig));

    // Compaction config: defaults are filled in here; an unknown mode falls back to
    // summarize (the default).
    const compactionConfig = state.systemConfig.compaction;
    const compaction: CompactionSettings = {
      maxContextLength: effectiveMaxContextLength(
        compactionConfig?.max_context_length ?? DEFAULT_MAX_CONTEXT_LENGTH,
        spec.modelEntry.context_window,
      ),
      maxSessionTurns: compactionConfig?.max_session_turns ?? -1,
      mode: compactionConfig?.mode === "discard" ? "discard" : "summarize",
      prompt: compactionConfig?.prompt ?? DEFAULT_COMPACTION_PROMPT,
    };

    // session_meta: this context's runtime configuration — the assembled prompt goes both to
    // the LLM and in here, so the Trace can audit the actual effective value and a resume
    // rebuilds the same request prefix; the toolset travels as the tool_list_ready event (it
    // is only known once the context's MCP Servers connected).
    const meta: SessionMetaPayload = {
      session_id: spec.sessionId,
      provider: spec.modelEntry.provider,
      model_id: spec.modelEntry.model_id,
      model_context_window: spec.modelEntry.context_window ?? "unknown",
      system_prompt: systemPrompt,
      agent_state: state.stateDir,
      workspace: spec.workspaceDir,
      ...(spec.source !== undefined ? { source: spec.source } : {}),
    };

    return {
      systemPrompt,
      vault,
      toolConfig,
      commandPolicy,
      thinkingLevel,
      // Configured output cap: the entry's per-model annotation wins over the Agent's
      // system_config value; unset inherits the Agent value. This is a ceiling, not the
      // literal wire value: GenerativeModel clamps each request's effective cap to what the
      // entry's context window can still fit (see llm/context-limits.ts, issue #218), so the
      // seeded per-Agent default (32000) no longer needs a manual per-model override to work
      // against e.g. a 32768-token window — setting the entry's `context_window` is enough.
      maxTokens: spec.modelEntry.max_tokens ?? state.systemConfig.model?.max_tokens,
      requestTimeoutMs: state.systemConfig.model?.timeoutMs,
      // Max turns is an Agent runtime parameter (system_config), not a Session option.
      maxTurns: state.systemConfig.max_turns,
      compaction,
      meta,
    };
  }

  /**
   * Create a Session in the specified (or a temporary) Workspace.
   * Docs: /docs/sessions-and-traces § "Run model".
   */
  async createSession(opts: CreateSessionOptions = {}): Promise<Session> {
    // Model is validated first (before creating the Workspace, so failure leaves no
    // temporary workspace behind): the reference must be the complete (provider, model_id)
    // pair — the config's unique key — and must name an entry in the Project config; a
    // reference outside the config throws immediately rather than passing silently,
    // otherwise credentials, pricing, and the context window would all be unavailable.
    // Half a reference is always an error: the missing half is never inferred, since a
    // guessed provider would send the entry's credential to a vendor nobody named.
    if ((opts.modelId === undefined) !== (opts.provider === undefined)) {
      throw new Error(
        "A model reference must be given as a (provider, model_id) pair: both must be specified, or neither (to use the Project's default model).",
      );
    }
    let ref: ModelRef;
    if (opts.modelId !== undefined && opts.provider !== undefined) {
      // Pair validation only (resolveModelRef): the pair either names a configured entry or errors.
      ref = resolveModelRef(this.projectConfig, opts.modelId, opts.provider);
    } else if (this.projectConfig.default_model) {
      ref = this.projectConfig.default_model;
    } else {
      throw new Error(
        "No modelId was specified and the Project config has no default_model. Use `penguin config model add/default` to set the default model.",
      );
    }
    const modelEntry = getModel(this.projectConfig, ref);
    if (!modelEntry) {
      throw new Error(
        `Model is not in the Project config: ${formatModelRef(ref)}. Use \`penguin config model list\` to see the configured models, or \`penguin config model add\` to add one.`,
      );
    }
    // Credentials are inlined on the model entry (single config file); an
    // explicit argument takes priority, falling back to AgentHub reading env vars
    // when both are absent.
    const apiKey = opts.apiKey ?? modelEntry.api_key;
    const baseUrl = opts.baseUrl ?? modelEntry.base_url;

    // An explicit Workspace must already exist as a directory: if it
    // doesn't, throw rather than auto-create (to avoid a typo silently working in
    // the wrong location); a temporary workspace is only created when unspecified.
    let workspaceDir: string;
    if (opts.workspaceDir) {
      workspaceDir = path.resolve(opts.workspaceDir);
      let stat;
      try {
        stat = await fs.stat(workspaceDir);
      } catch {
        throw new Error(
          `Workspace does not exist: ${workspaceDir}. Specify an existing directory, or omit the Workspace to use a temporary workspace.`,
        );
      }
      if (!stat.isDirectory()) {
        throw new Error(`Workspace is not a directory: ${workspaceDir}.`);
      }
    } else {
      workspaceDir = await createTempWorkspace(
        this.state.root,
        this.state.projectId,
        this.state.agentId,
      );
    }
    const sessionId = formatSessionId();
    const spec: SessionSpec = {
      sessionId,
      workspaceDir,
      modelEntry,
      apiKey,
      baseUrl,
      thinkingLevel: opts.thinkingLevel,
      subagentDepth: opts.subagentDepth ?? 0,
      ...(opts.source !== undefined ? { source: opts.source } : {}),
    };
    // The first context: assembled from the Agent State on disk now (never from this Agent
    // object's load-time snapshot — a long-lived Agent, a self-spawned subagent's for
    // instance, would otherwise start Sessions on stale configuration).
    const context = await this.assembleContext(spec);
    const rt = this.buildRuntime(spec, context);

    const hooks = await this.sessionHooks(
      rt.subagentRunner,
      spec.subagentDepth > 0 || opts.source === "subagent",
    );

    const trace = new Writer({
      tracesDir: tracesDir(this.state.root, this.state.projectId, this.state.agentId),
      sessionId,
    });

    return this.newSession(spec, context, rt, trace, { ...(hooks ? { hooks } : {}) });
  }

  /**
   * Resume an existing Session and continue the conversation.
   *
   * The resume source is the Session's **latest-index** Trace file: the Session-fixed facts
   * are read from its `session_meta` (Model and Workspace carry over from the original
   * Session and cannot be changed), and the context is assembled from the current Agent
   * State — keeping the recorded system prompt when the file's context is still open (see
   * below). The replayed, already-committed history is injected once via AgentHub's
   * setHistory (used only on resume); any leftover input is rebuilt as carry-over (paired
   * fallback placeholders are synthesized in memory only, never written to the Trace).
   * Messages after resume continue in the original Trace file (the file follows the
   * context, not the date), and Token / turn-count stats carry over from their original
   * values.
   * Docs: /docs/sessions-and-traces § "Session recovery".
   */
  async resumeSession(opts: ResumeSessionOptions): Promise<Session> {
    const { sessionId } = opts;
    const dir = tracesDir(this.state.root, this.state.projectId, this.state.agentId);
    const located = await findLatestTraceFile(dir, sessionId);
    if (!located) {
      throw new Error(
        `Session does not exist: ${sessionId} (no matching Trace file found under ${dir}).`,
      );
    }
    const resumed = resumeTrace(await readTraceTolerant(located.path));
    if (!resumed.meta) {
      throw new Error(`Trace is missing session_meta and cannot be resumed: ${located.path}`);
    }
    const meta = resumed.meta.payload;
    // Model reference is stored as a pair in session_meta; a missing provider means legacy data (no migration since the product hasn't shipped yet).
    if (typeof meta.provider !== "string") {
      throw new Error(
        `Trace is from legacy data (session_meta is missing provider; the model reference is not split into separate fields): ${located.path}. Delete the data directory and recreate the Session.`,
      );
    }

    // The Workspace carries over from the original Session and must still exist (throw if missing, never auto-create).
    const workspaceDir = meta.workspace;
    let stat;
    try {
      stat = await fs.stat(workspaceDir);
    } catch {
      throw new Error(
        `The original Session's Workspace no longer exists: ${workspaceDir}; cannot resume.`,
      );
    }
    if (!stat.isDirectory()) {
      throw new Error(
        `The original Session's Workspace is not a directory: ${workspaceDir}; cannot resume.`,
      );
    }

    // The Model carries over from the original Session (paired reference) and must still be present in the Project config.
    const ref: ModelRef = { provider: meta.provider, model_id: meta.model_id };
    const modelEntry = getModel(this.projectConfig, ref);
    if (!modelEntry) {
      throw new Error(
        `The original Session's Model is not in the Project config: ${formatModelRef(ref)}. Use \`penguin config model add\` to configure it again before resuming.`,
      );
    }
    const apiKey = opts.apiKey ?? modelEntry.api_key;
    const baseUrl = opts.baseUrl ?? modelEntry.base_url;

    // No level at resume: the host re-applies its stored value (Session.thinkingLevel) when it holds one,
    // and contexts opened without a pin read the Agent config's chain (the same chain
    // createSession uses). The origin carries over from the original session_meta (a
    // resumed scheduled/subagent Session stays marked); the on-disk value is untrusted: only
    // the exact known origins pass, junk written by a third party is dropped rather than
    // cast through.
    const spec: SessionSpec = {
      sessionId,
      workspaceDir,
      modelEntry,
      apiKey,
      baseUrl,
      thinkingLevel: undefined,
      subagentDepth: 0,
      ...(meta.source === "subagent" || meta.source === "schedule" ? { source: meta.source } : {}),
    };
    // The context follows the Trace. A context a completed compaction closed is opened here
    // for the first time — nothing was produced under any configuration yet — so it is
    // assembled from the current Agent State exactly as the compaction would have opened it,
    // and the rotation deferred to the first write records its meta at the new file's head.
    // An open context keeps the system prompt its file recorded — the history replayed into
    // it was produced under that request prefix — while its tools, Environment, vault and
    // run parameters can only come from the current Agent State: the Trace records no
    // executable configuration (tool definitions travel with every Request and are not part
    // of the history). The thinking level is a per-request parameter, not part of the
    // recorded prefix: it resolves from the pin and the config like on any other open.
    const context = await this.assembleContext(
      spec,
      resumed.contextClosed ? {} : { systemPrompt: meta.system_prompt },
    );
    const rt = this.buildRuntime(spec, context);

    // History is injected once into the freshly built context object as part of the lazy
    // bootstrap (setHistory is only used on resume); Session cumulative Token counts carry
    // over the same way. The wrap keeps the descriptive error: bad tool arguments in the
    // history (e.g. truncated JSON written by a third-party OpenAI-compatible endpoint)
    // throw a raw SyntaxError during conversion, and the message must indicate Trace
    // history corruption rather than a regular runtime error. With the bootstrap being
    // lazy, that corruption now surfaces on the first run instead of at resume time —
    // the price of a resume that no longer blocks on MCP connects.
    const bootstrap: typeof rt.bootstrap = async (opts) => {
      const r = await rt.bootstrap(opts);
      if (resumed.history.length > 0) {
        try {
          r.llm.setHistory(resumed.history);
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          throw new Error(
            `Resume failed: the Trace history could not be injected (records may be corrupted, e.g. invalid tool-argument JSON): ${detail}`,
          );
        }
      }
      return r;
    };

    const hooks = await this.sessionHooks(rt.subagentRunner, meta.source === "subagent");

    // Continue writing to the original Trace file (the Trace only records real messages; synthesized paired placeholders are re-emitted in memory alongside carry-over).
    const trace = new Writer({
      tracesDir: dir,
      sessionId,
      dateDir: located.dateDir,
      startIndex: located.index,
    });

    // A compaction the user quit out of (a compaction_begin with no end — the process died
    // mid-request) is simply a **failed** compaction: close the span with a `failed`
    // compaction_end before any new record lands, and discard whatever half-summary it had
    // written — nothing is reconstructed from it (the original context is intact and the
    // standing threshold makes the compaction up at the next trigger). Closing the span is
    // what keeps the rest of the conversation visible: readers treat messages between the
    // paired events as compaction-internal, so an unclosed span would hide everything the
    // user sends afterwards, and tool outputs whose calls it swallowed would render as
    // "unknown tool" cards (issue #288). Best-effort like every Trace write: a failure here
    // must not block the resume itself.
    if (resumed.danglingCompaction) {
      try {
        await trace.write(compactionEnd({ ...resumed.danglingCompaction, status: "retryable" }));
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[trace] interrupted-compaction closure failed: ${detail}\n`);
      }
    }

    return this.newSession(spec, context, rt, trace, {
      bootstrap,
      ...(hooks ? { hooks } : {}),
      // session_meta is already in the original Trace file, so it isn't rewritten; on the first write after a compaction-triggered rotation, the file is split first.
      metaAlreadyWritten: true,
      initialEngineState: {
        carryOver: resumed.carryOver,
        ...(resumed.pendingSummary ? { pendingSummary: resumed.pendingSummary } : {}),
        sessionTurns: resumed.sessionTurns,
        sessionTokens: resumed.sessionTokens,
        lastRequestTotal: resumed.lastRequestTotal,
        pendingTraceRotation: resumed.contextClosed,
        // A closed context is one a completed compaction opened: the same fact drives the
        // deferred Trace rotation above and the "just compacted" compaction reason, but they
        // are separate meanings and stay separate fields.
        fromCompaction: resumed.contextClosed,
      },
      resumedHistory: resumed.renderMessages,
    });
  }

  /**
   * Constructs the Session for `spec` running on `context` — the one assembly behind
   * createSession and resumeSession, so initialization and resumption cannot drift apart.
   * `extras` carries the resume-only fields (its history-injecting bootstrap wrapper, the
   * replay-derived engine state); spread last, so an override there wins.
   */
  private newSession(
    spec: SessionSpec,
    context: AssembledContext,
    rt: SessionRuntime,
    trace: Writer,
    extras: Partial<SessionConfig> = {},
  ): Session {
    const { root, projectId, agentId } = this.state;
    return new Session({
      meta: context.meta,
      bootstrap: rt.bootstrap,
      cancelBootstrap: () => rt.environment.cancelMcpConnect(),
      environment: rt.environment,
      trace,
      openNextContext: rt.openNextContext,

      createBareLLM: rt.createBareLLM,
      compaction: context.compaction,
      // Where an input image lands when it becomes a path line (see SessionConfig.imagesDir).
      imagesDir: sessionScratchpadDir(root, projectId, agentId, spec.sessionId),
      modelHasVision: spec.modelEntry.vision !== false,
      ...(context.maxTurns !== undefined ? { maxTurns: context.maxTurns } : {}),
      // Sandbox command policy, strict-tier like the rest of the context (though
      // Project-owned, never Agent State): read from disk when each context opens, so an
      // edit applies at the Session's next rotation. Absent config means the factory rule
      // set, on. Tool permissions need no seam of their own: Session.toolPermission
      // answers from the Environment's toolset, which each rotation re-equips.
      commandPolicy: rt.commandPolicy,
      ...extras,
    });
  }

  /** Id of the most recent Session under the current Agent (determined by the timestamp in session_id); returns null if there is no Session. */
  async latestSessionId(): Promise<string | null> {
    return latestTraceSessionId(
      tracesDir(this.state.root, this.state.projectId, this.state.agentId),
    );
  }

  /**
   * Assembles a Session's runtime components (shared by createSession and resumeSession)
   * around the context it starts in — see {@link SessionRuntime} for what each part does.
   */
  private buildRuntime(spec: SessionSpec, initial: AssembledContext): SessionRuntime {
    const { sessionId, workspaceDir, modelEntry, apiKey, baseUrl, subagentDepth } = spec;
    // The context the Session is running: the initial one, then whatever `openNextContext` last
    // assembled.
    let current = initial;
    // Child-Agent runner: injected into the run_subagent tool so it doesn't need to
    // depend on Agent/Session (breaking a circular dependency). The model can
    // optionally choose agentId (omitted = call the current Agent), the child
    // Session's model (omitted = the parent Session's model), and its thinking level
    // (omitted = the parent Session's effective level); an explicit model reference
    // is forwarded to createSession as-is and must be a complete (provider, model_id)
    // pair — half a reference is rejected there rather than being guessed here. Precheck
    // errors (depth limit exceeded / agent doesn't exist) are expressed as throws, which
    // the Environment collapses to failed.
    // Docs: /docs/interfaces § "Subagent interfaces"
    const parentAgent = this;
    const { root, projectId, agentId: parentAgentId } = this.state;
    const subagentRunner: SubagentRunner = {
      // Spawn and run are separate: the same child Session can run for multiple turns
      // (continuing via input_subagent appending a prompt); resource cleanup is
      // consolidated in handle.dispose (called by the managing ManagedSubagentSession).
      async spawn({ agentId, modelId, provider, thinkingLevel: spawnThinkingLevel }) {
        if (subagentDepth >= MAX_SUBAGENT_DEPTH) {
          throw new Error(
            `subagent depth limit ${MAX_SUBAGENT_DEPTH} reached; not spawning another subagent`,
          );
        }
        if (agentId !== undefined && agentId !== parentAgentId) {
          try {
            assertValidId("agent_id", agentId);
            await fs.access(systemConfigPath(root, projectId, agentId));
          } catch {
            throw new Error(
              `subagent error: agent "${agentId}" does not exist or is not accessible`,
            );
          }
        }
        const childAgent =
          agentId !== undefined && agentId !== parentAgentId
            ? await createAgent({
                root,
                projectId,
                agentId,
                // A child Agent loads its own vault/config, but the proxy-env and
                // control-env policy getters are host policy, not Agent state: the
                // subagent's commands run in the same serving process, so they follow the
                // same settings as the parent's — controlEnv is then evaluated with the
                // child Session's own coordinates.
                ...(parentAgent.proxyEnv ? { proxyEnv: parentAgent.proxyEnv } : {}),
                ...(parentAgent.controlEnv ? { controlEnv: parentAgent.controlEnv } : {}),
              })
            : parentAgent;
        // The child Session follows the PARENT Session, never the Project default: with the
        // model pair fully omitted it reuses the parent's resolved (provider, model_id) —
        // the same Project-config entry, so max_tokens / context_window / vision follow
        // automatically. An explicit pair still wins, and half a pair is forwarded as-is so
        // createSession rejects it (never silently completed from the parent's here).
        const childModel =
          modelId === undefined && provider === undefined
            ? { modelId: modelEntry.model_id, provider: modelEntry.provider }
            : {
                ...(modelId !== undefined ? { modelId } : {}),
                ...(provider !== undefined ? { provider } : {}),
              };
        // An explicit spawn-time level (run_subagent's `thinking_level`) pins the child;
        // otherwise the parent Session's creation-time level, else the base its running
        // context opened with, is passed down as a tri-state: `null` when the parent has
        // none, so the child never falls back to its own Agent config (which would apply on
        // a cross-agent spawn). A mid-session `Session.thinkingLevel` assignment is engine
        // state and is not inherited — the spawn argument exists for explicit control.
        const parentLevel =
          spec.thinkingLevel === undefined ? current.thinkingLevel : spec.thinkingLevel;
        const childSession = await childAgent.createSession({
          workspaceDir,
          ...childModel,
          thinkingLevel: spawnThinkingLevel ?? parentLevel ?? null,
          subagentDepth: subagentDepth + 1,
          source: "subagent",
        });
        return subagentHandleFor(childSession);
      },
      // Revival: a RELEASED child session resumes with its own history, model and Workspace
      // (resumeSession semantics) — reached by the panel and by input_subagent on a released
      // id alike. The owning Agent comes from the caller's record (the host's session
      // registry, or the spawn-time tombstone); omitted or self-owned reuses the parent
      // Agent instance.
      async resume({ agentId, sessionId }) {
        if (agentId !== undefined) assertValidId("agent_id", agentId);
        const childAgent =
          agentId === undefined || agentId === parentAgentId
            ? parentAgent
            : await createAgent({
                root,
                projectId,
                agentId,
                ...(parentAgent.proxyEnv ? { proxyEnv: parentAgent.proxyEnv } : {}),
                ...(parentAgent.controlEnv ? { controlEnv: parentAgent.controlEnv } : {}),
              });
        const childSession = await childAgent.resumeSession({ sessionId });
        return subagentHandleFor(childSession);
      },
    };

    /**
     * Wraps a child Session as a SubagentHandle — shared by spawn and resume. All
     * child-session messages are tagged with an origin (the child Session id, prepended as
     * one hop from outer to inner); the first turn forwards the child's session_meta first
     * (including agent_state and other metadata) so the parent frontend can recognize the
     * nested session (for rendering, stats, approval visibility); the parent Trace skips
     * these accordingly (the child Session has its own Trace, linked by session id).
     */
    function subagentHandleFor(childSession: Session): SubagentHandle {
      const hop: MessageOrigin = childSession.sessionId;
      let metaSent = false;
      return {
        sessionId: hop,
        // One-shot upfront meta for background launches (see SubagentHandle.takeMeta):
        // shares metaSent with run, so the meta reaches the parent stream exactly once
        // whichever side sends it first.
        takeMeta() {
          if (metaSent) return null;
          metaSent = true;
          return withOrigin(childSession.metaMessage, hop);
        },
        async *run({ messages, signal, approve }) {
          if (!metaSent) {
            metaSent = true;
            yield withOrigin(childSession.metaMessage, hop);
          }
          // Pass through the parent's approval callback: the child Session inherits
          // the parent Agent's approval mode (with no callback, the child engine
          // defaults to deny). The tool_call received for approval also carries the
          // origin, so the approval UI can identify which tool a subagent is calling.
          const childApprove = approve
            ? (tc: OmniMessage<ToolCallPayload>) => approve(withOrigin(tc, hop))
            : undefined;
          // The engine writes a run's input to the CHILD's own Trace but never replays
          // it to its consumer (a session's normal caller typed that input itself) —
          // here the consumer is the PARENT, whose frontend has never seen the child's
          // prompt. Forward the input messages themselves (origin-tagged, ahead of the
          // run's output) so the live nested view shows the child's user side exactly
          // like a reloaded one (history expansion splices the child Trace, which
          // carries these same messages). The parent engine drops origin messages from
          // the parent Trace, so replay never duplicates them. Later rounds
          // (input_subagent follow-up prompts, a host panel's message) come through this
          // same generator and are forwarded the same way.
          // The caller owns each message's `sender` — "parent_agent" for the model's own
          // dispatch, none for a human's message from a host panel — so the child's Trace
          // records who actually spoke.
          for (const input of messages) yield withOrigin(input, hop);
          // Manual iteration so the child run's return value — whether the round was cut
          // off — propagates to the handle's own return for the parent's round report.
          const it = childSession.run(messages, {
            ...(signal ? { signal } : {}),
            ...(childApprove ? { approve: childApprove } : {}),
          });
          for (;;) {
            const res = await it.next();
            if (res.done) return res.value;
            yield withOrigin(res.value, hop);
          }
        },
        // Mid-run steering rides the child Session's own steering queue — the same
        // mechanism a user steers the main session with. The queued message keeps its
        // caller-chosen sender ("parent_agent" from input_subagent, none from a human
        // panel), and the delivered [user_steering] message streams back out through
        // `run` with the origin hop like every other child message.
        steer(messages) {
          return childSession.steer(messages);
        },
        setThinkingLevel(level) {
          childSession.thinkingLevel = level;
        },
        dispose() {
          childSession.dispose();
        },
      };
    }

    // When the session model doesn't support images (vision=false): inject a vision
    // model service for describe_image (forModel: "text-only", selected by the tool
    // filter in assembleContext) — images are described by the Project config's
    // vision_model (a paired reference), and the tool returns text. Even when unconfigured
    // or invalid, it is still injected (modelId=null); the tool then finishes with a failed
    // explanation, and images are never allowed into that session's history.
    let visionDescriber: VisionDescriberService | undefined;
    if (modelEntry.vision === false) {
      const visionRef = this.projectConfig.vision_model;
      const visionEntry = visionRef ? getModel(this.projectConfig, visionRef) : undefined;
      if (visionEntry && visionEntry.vision !== false) {
        visionDescriber = {
          // The model attribution in the tool output matches the request's source: both are the entry's upstream model_id.
          modelId: visionEntry.model_id,
          createLLM: () =>
            new GenerativeModel({
              modelId: visionEntry.model_id,
              ...(visionEntry.api_key !== undefined ? { apiKey: visionEntry.api_key } : {}),
              ...(visionEntry.base_url !== undefined ? { baseUrl: visionEntry.base_url } : {}),
              ...(visionEntry.client_type !== undefined
                ? { clientType: visionEntry.client_type }
                : {}),
              tools: [],
              thinkingLevel: "none",
              // The describing budget, tightened by the vision entry's own pinned cap when smaller.
              maxTokens: metaMaxTokens(2048, visionEntry.max_tokens),
              // Same window derivation as ordinary requests (a formality here: the meta
              // budget is far below any real window, so the clamp never binds).
              ...(visionEntry.context_window !== undefined
                ? { contextWindow: visionEntry.context_window }
                : {}),
              requestTimeoutMs: 60_000,
            }),
        };
      } else {
        visionDescriber = { modelId: null };
      }
    }

    // Environment binds the Workspace for the Session's lifetime and is equipped with the
    // initial context's tool config and vault (a later context re-equips it, see
    // openNextContext). The toolset is resolved lazily by the bootstrap below (Session's first
    // run), not here — its first listTools connects any configured MCP Servers, and that
    // wait belongs on the run stream (bracketed by mcp_connect events), not inside
    // createSession. Vault environment variables are injected into command subprocesses; a
    // child Agent loads **its own** vault via createAgent rather than inheriting the
    // parent's.
    const environment = new Environment({
      workspaceDir,
      toolConfig: initial.toolConfig,
      // The Session's generic scratchpad root; Environment derives its truncated-tool-output
      // recovery directory from it.
      sessionScratchpadDir: sessionScratchpadDir(
        this.state.root,
        this.state.projectId,
        this.state.agentId,
        sessionId,
      ),
      services: { subagentRunner, ...(visionDescriber ? { visionDescriber } : {}) },
      ...(Object.keys(initial.vault).length > 0 ? { vault: initial.vault } : {}),
      ...(this.proxyEnv ? { proxyEnv: this.proxyEnv } : {}),
      // The control-env policy is bound to THIS Session's coordinates here (sessionId is
      // final by now); the getter shape keeps it re-evaluated at every command spawn, so
      // the host can rotate what it injects (e.g. its API token) without a rebuild.
      ...(this.controlEnv
        ? {
            controlEnv: () =>
              this.controlEnv!({
                projectId: this.state.projectId,
                agentId: this.state.agentId,
                sessionId,
              }),
          }
        : {}),
    });

    // The tool_call_id uniqueness registry is shared by every context's LLM object: its
    // uniqueness scope is the Session's whole render span, so same-named tool calls after
    // compaction don't collide with earlier cards' ids.
    const toolCallIds = new ToolCallIdAllocator();
    // The LLM object of one context: the Session-fixed model entry and credentials, plus the
    // context's prompt, toolset and model defaults. The model id sent to AgentHub is always
    // the entry's upstream `model_id` (client_type inference/passing follows it);
    // session_meta, Trace, usage, pricing, and catalog matching all use the (provider,
    // model_id) pair as the primary key.
    const buildLLM = (context: AssembledContext, tools: ToolDefinition[]): GenerativeModel =>
      new GenerativeModel({
        modelId: modelEntry.model_id,
        toolCallIds,
        ...(apiKey !== undefined ? { apiKey } : {}),
        ...(baseUrl !== undefined ? { baseUrl } : {}),
        ...(modelEntry.client_type !== undefined ? { clientType: modelEntry.client_type } : {}),
        tools,
        systemPrompt: context.systemPrompt,
        ...(modelEntry.context_window !== undefined
          ? { contextWindow: modelEntry.context_window }
          : {}),
        ...(context.maxTokens !== undefined ? { maxTokens: context.maxTokens } : {}),
        // Fast mode is a session-request annotation: it rides every context's LLM object,
        // while the bare/meta LLM below and the vision describer deliberately skip it — their
        // background requests gain nothing user-facing from a premium tier, and skipping
        // keeps them working (titles included) even while the annotation is enabled on a
        // model that rejects it.
        ...(modelEntry.fast_mode === true ? { fastMode: true } : {}),
        ...(context.thinkingLevel !== undefined ? { thinkingLevel: context.thinkingLevel } : {}),
        ...(context.requestTimeoutMs !== undefined
          ? { requestTimeoutMs: context.requestTimeoutMs }
          : {}),
      });

    // THE opening procedure — behind the first run's bootstrap and every post-compaction
    // openNextContext alike, so initialization and rotation cannot drift apart: connects
    // whatever MCP Servers are still pending on the Environment (publishing the connect
    // pair around the wait when there are any — at the first open that is every configured
    // server), resolves the toolset, publishes the toolset record, and builds the context's
    // LLM object. The caller's `emit` decides where the records go live (the Session's
    // first-run pump, or the engine's rotation pump).
    const openAssembled = async (
      context: AssembledContext,
      emit: OpenContextOptions["emit"],
    ): Promise<{ llm: GenerativeModel }> => {
      const pending = environment.pendingMcpServerNames();
      if (pending.length > 0) emit(mcpConnectBegin(pending));
      const tools = await environment.listTools();
      if (pending.length > 0) {
        emit(mcpConnectEnd(mcpConnectOutcome(environment.mcpConnectResults())));
      }
      emit(toolListReady(tools));
      return { llm: buildLLM(context, tools) };
    };

    // The first context's opener (see SessionRuntime.bootstrap).
    const bootstrap = async (opts: OpenContextOptions): Promise<{ llm: GenerativeModel }> =>
      openAssembled(current, opts.emit);

    // The context that follows a completed compaction: assembled anew from the Agent State
    // as it is now — an edit the model (or the user) made during the old context to
    // AGENTS.md, system_config.yaml, the vault, the Skills or the MCP Servers lands here.
    // The Environment is re-equipped with the new toolset and vault, then the context is
    // opened by the same procedure as the first one — the engine yields the published
    // records live and writes them at the head of the rotated Trace file. An Agent State
    // that cannot be assembled (a config that no longer parses) throws: the run fails with
    // that error and the engine keeps the old context.
    const openNextContext = async ({ emit }: OpenContextOptions): Promise<OpenedContext> => {
      const next = await this.assembleContext(spec);
      current = next;
      environment.reconfigure({ toolConfig: next.toolConfig, vault: next.vault });
      const { llm } = await openAssembled(next, emit);
      return {
        llm,
        sessionMeta: sessionMeta(next.meta),
        maxTurns: next.maxTurns ?? -1,
        compaction: next.compaction,
      };
    };

    // Bare LLM for one-off out-of-band requests (meta requests like generateTitle):
    // same Model/credentials, no tools, no system prompt, thinking disabled, a small
    // output cap, and an independent timeout.
    const createBareLLM = (): GenerativeModel =>
      new GenerativeModel({
        modelId: modelEntry.model_id,
        ...(apiKey !== undefined ? { apiKey } : {}),
        ...(baseUrl !== undefined ? { baseUrl } : {}),
        ...(modelEntry.client_type !== undefined ? { clientType: modelEntry.client_type } : {}),
        tools: [],
        thinkingLevel: "none",
        // The meta budget, tightened by the entry's pinned per-model cap when smaller.
        maxTokens: metaMaxTokens(300, modelEntry.max_tokens),
        // Same window derivation as ordinary requests (a formality here: the meta budget
        // is far below any real window, so the clamp never binds).
        ...(modelEntry.context_window !== undefined
          ? { contextWindow: modelEntry.context_window }
          : {}),
        requestTimeoutMs: 30_000,
      });

    // Credential validation stays at Session-creation time even though the session LLM is
    // built lazily now: provider SDKs throw at **client construction** when a credential
    // is missing (e.g. OpenAI-protocol models without apiKey/OPENAI_API_KEY), and hosts
    // map that into their clean "credential missing" error before any Session or Trace
    // exists. Constructing the bare LLM (same credentials, no tools, no network) keeps
    // that throw here; the instance is discarded.
    createBareLLM();

    return {
      environment,
      bootstrap,
      openNextContext,
      commandPolicy: () => current.commandPolicy,

      createBareLLM,
      subagentRunner,
    };
  }

  /**
   * The hooks of a top-level Session: every hook package installed in the Agent's
   * `agent_state/hooks/` whose manifest does not switch it off (read fresh per Session, like
   * skills), each command run as a script (hooks/script-hook.ts), plus the spawner that
   * honors a hook's `subagent` answer —
   * a detached child Session of this Agent (or the one it names) whose stream is dropped (its
   * own Trace is the record) and which inherits the run's approval callback. Child Sessions —
   * spawned or revived subagents — carry no hooks: a subagent's work belongs to its parent's
   * Trace, and a child could not spawn a subagent anyway.
   */
  private async sessionHooks(
    runner: SubagentRunner,
    child: boolean,
  ): Promise<SessionHooks | undefined> {
    if (child) return undefined;
    // A package switched off in its manifest stays installed — listed, exportable — but is
    // left out here, the one place a Session's hooks are assembled.
    const installed = (
      await listInstalledHooks(this.state.root, this.state.projectId, this.state.agentId)
    ).filter(hookPackageEnabled);
    const stop = installed.flatMap((hook) =>
      hook.stop.map((cmd) => scriptStopHook(hook.name, hook.dir, cmd.command, cmd.timeout)),
    );
    const preToolUse = installed.flatMap((hook) =>
      hook.pre_tool_use.map((cmd) =>
        scriptPreToolUseHook(hook.name, hook.dir, cmd.command, cmd.timeout),
      ),
    );
    const userPrompt = installed.flatMap((hook) =>
      hook.user_prompt.map((cmd) =>
        scriptUserPromptHook(hook.name, hook.dir, cmd.command, cmd.timeout),
      ),
    );
    if (stop.length === 0 && preToolUse.length === 0 && userPrompt.length === 0) return undefined;
    return {
      ...(stop.length > 0 ? { stop } : {}),
      ...(preToolUse.length > 0 ? { preToolUse } : {}),
      ...(userPrompt.length > 0 ? { userPrompt } : {}),
      spawnSubagent: async (request: HookSubagentRequest, approve?: ApproveFn) => {
        const handle = await runner.spawn({
          ...(request.agentId !== undefined ? { agentId: request.agentId } : {}),
        });
        // The child's upfront session_meta goes back to the Session, which streams it behind
        // the hook event so a host registers the child session (a row, a place in the
        // subagent listing) the way it does a tool-spawned one; the detached run then skips
        // its own meta forwarding.
        const meta = handle.takeMeta?.() ?? null;
        runDetached(handle, [userText(request.prompt, "harness")], approve);
        return { sessionId: handle.sessionId, meta };
      },
    };
  }
}

/** Drives a hook-spawned child to completion in the background, dropping its stream (its own Trace is the record), and releases it. */
function runDetached(handle: SubagentHandle, messages: OmniMessage[], approve?: ApproveFn): void {
  void (async () => {
    try {
      const it = handle.run({ messages, ...(approve ? { approve } : {}) });
      for (;;) {
        const res = await it.next();
        if (res.done) break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[hooks] subagent ${handle.sessionId} failed: ${message}\n`);
    } finally {
      handle.dispose();
    }
  })();
}
