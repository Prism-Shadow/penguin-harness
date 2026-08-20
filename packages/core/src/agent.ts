/**
 * Agent and the `createAgent` entry point.
 *
 * `createAgent` is the unified way to create/load an Agent: it initializes Agent State
 * if the directory is empty, otherwise loads by agentId.
 * An Agent has exactly one Agent State and can run multiple times; the
 * Workspace is determined when a Session is created.
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  assertValidId,
  assembleSystemPrompt,
  buildToolConfig,
  selectBuiltinToolsForModel,
  DEFAULT_COMPACTION_PROMPT,
  formatModelRef,
  getModel,
  listInstalledSkills,
  listScheduleNames,
  loadAgentVault,
  loadOrInitAgentState,
  loadProjectConfig,
  projectDir,
  goalFilePath,
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
import {
  createTempWorkspace,
  formatSessionId,
  sessionEnvironment,
} from "./internal/session-support.js";
import { compactionEnd, userText, withOrigin } from "./omnimessage/index.js";
import type {
  McpServerConnectResult,
  MessageOrigin,
  OmniMessage,
  TokenCounts,
  ToolCallPayload,
} from "./omnimessage/index.js";
import { SUBAGENT_NAME } from "./environment/tools/run-subagent.js";
import { INPUT_SUBAGENT_NAME } from "./environment/tools/input-subagent.js";
import { KILL_SUBAGENT_NAME } from "./environment/tools/kill-subagent.js";
import type { CompactionSettings } from "./engine/context-engine.js";
import type {
  GenerativeModelConfig,
  ProxyEnvPolicy,
  SubagentRunner,
  ThinkingLevelName,
  ToolDefinition,
  VisionDescriberService,
} from "./interfaces.js";
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
   *   `"medium"` (see `configuredThinkingLevel`);
   * - `null` means "no thinking level": the config fallback is suppressed entirely
   *   (nothing goes into the LLM config; session_meta echoes `"default"`).
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

/** Create or load an Agent. */
export async function createAgent(opts: CreateAgentOptions = {}): Promise<Agent> {
  const state = await loadOrInitAgentState(opts);
  const projectConfig = await loadProjectConfig(state.root, state.projectId);
  return new Agent(state, projectConfig, opts.proxyEnv);
}

export class Agent {
  constructor(
    readonly state: AgentState,
    readonly projectConfig: ProjectConfig,
    /** See {@link CreateAgentOptions.proxyEnv}; forwarded into every Session's Environment. */
    private readonly proxyEnv?: () => ProxyEnvPolicy | null,
  ) {}

  /**
   * A Session's default thinking level when no explicit per-session level is given — the
   * resolution chain (the single rule, keep both sites on it): the Agent's explicit
   * `model.thinking_level` > the Project's `default_chat.thinking_level` > the built-in
   * `"medium"` (the documented Agent default). Mirrored by the web draft picker's DISPLAY
   * (web features/chat/thinking-level.ts `effectiveThinkingLevel`): the picker shows this
   * effective value, and a pick writes through to the AGENT config — the project default
   * is only ever a fallback, never overwritten from there.
   */
  private configuredThinkingLevel(): ThinkingLevelName {
    return (
      this.state.systemConfig.model?.thinking_level ??
      this.projectConfig.default_chat?.thinking_level ??
      "medium"
    );
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
    const subagentDepth = opts.subagentDepth ?? 0;
    // Effective thinking level (tri-state option): a value wins over every config; `null` —
    // how subagent spawning says "the parent has none" — suppresses the config fallback
    // entirely; only `undefined` (no option) reads the config chain (Agent explicit >
    // Project default_chat > built-in "medium", see configuredThinkingLevel).
    const thinkingLevel =
      opts.thinkingLevel === null
        ? undefined
        : (opts.thinkingLevel ?? this.configuredThinkingLevel());

    // Agent-level vault (agent_state/.vault.toml) and installed Skills: read the current values each time a Session is created.
    const vault = await loadAgentVault(this.state.root, this.state.projectId, this.state.agentId);
    const installedSkills = await listInstalledSkills(
      this.state.root,
      this.state.projectId,
      this.state.agentId,
    );
    // Schedule task names for the {{SCHEDULES}} roster: read fresh like the vault and Skills
    // above (names only; the files' contents are the server-side scheduler's concern).
    const scheduleNames = await listScheduleNames(
      this.state.root,
      this.state.projectId,
      this.state.agentId,
    );
    // Memory for this Session: null when the Agent has Memory off; a temporary Workspace gets
    // the user scope only (nothing written against it could ever be read back). Reads the
    // current indexes every time, like the vault and Skills above.
    const memory = await resolveSessionMemory({
      root: this.state.root,
      projectId: this.state.projectId,
      agentId: this.state.agentId,
      workspaceDir,
      enabled: this.state.systemConfig.memory?.enabled !== false,
    });

    // The assembled system prompt goes both to the LLM and into session_meta (so the
    // Trace can audit the actual effective value). The vault only injects **key names**
    // into the prompt (so the model knows which API keys are available); values only
    // go into the subprocess environment. Skills only inject metadata (name and
    // description); the model reads the body on demand via shell. Memory likewise injects
    // only its index; topic bodies are read on demand. Schedules inject only task names.
    const systemPrompt = assembleSystemPrompt(
      this.state,
      sessionEnvironment(workspaceDir, sessionId, {
        agentId: this.state.agentId,
        projectDir: projectDir(this.state.root, this.state.projectId),
        provider: modelEntry.provider,
        modelId: modelEntry.model_id,
      }),
      Object.keys(vault),
      installedSkills,
      memory,
      scheduleNames,
    );

    const rt = await this.buildRuntime({
      sessionId,
      workspaceDir,
      modelEntry,
      apiKey,
      baseUrl,
      systemPrompt,
      thinkingLevel,
      subagentDepth,
      vault,
    });

    const trace = new Writer({
      tracesDir: tracesDir(this.state.root, this.state.projectId, this.state.agentId),
      sessionId,
    });

    return new Session({
      // session_meta holds per-session invariants only: the thinking level is a per-turn
      // run parameter (RunOptions.thinkingLevel) and is deliberately not recorded here;
      // the toolset travels as the first run's tool_list_ready event (it is only known
      // after the MCP connect the bootstrap performs).
      meta: {
        session_id: sessionId,
        provider: modelEntry.provider,
        model_id: modelEntry.model_id,
        model_context_window: modelEntry.context_window ?? "unknown",
        system_prompt: systemPrompt,
        agent_state: this.state.stateDir,
        workspace: workspaceDir,
        ...(opts.source !== undefined ? { source: opts.source } : {}),
      },
      bootstrap: rt.bootstrap,
      cancelBootstrap: () => rt.environment.cancelMcpConnect(),
      mcpServers: rt.environment.mcpServerNames(),
      environment: rt.environment,
      trace,
      createLLM: rt.createLLM,
      createBareLLM: rt.createBareLLM,
      compaction: rt.compaction,
      // Where an input image lands when it becomes a path line (see SessionConfig.imagesDir).
      imagesDir: sessionScratchpadDir(
        this.state.root,
        this.state.projectId,
        this.state.agentId,
        sessionId,
      ),
      modelHasVision: modelEntry.vision !== false,
      // Goal mode's control file lives in the session scratchpad; the path is fixed per
      // Session, so it is wired here rather than passed per-run.
      goalFilePath: goalFilePath(
        this.state.root,
        this.state.projectId,
        this.state.agentId,
        sessionId,
      ),
      // Max turns comes from the Agent's system_config (runtime parameters belong to the Agent config).
      ...(this.state.systemConfig.max_turns !== undefined
        ? { maxTurns: this.state.systemConfig.max_turns }
        : {}),
    });
  }

  /**
   * Resume an existing Session and continue the conversation.
   *
   * The resume source is the Session's **latest-index** Trace file: runtime config is
   * read from its `session_meta` (Model, the original system prompt text, and the
   * Workspace all carry over from the original Session and cannot be changed), while
   * tools and Environment are reassembled from the current Agent State. The replayed,
   * already-committed history is injected once via AgentHub's setHistory (used only on
   * resume); any leftover input is rebuilt as carry-over (paired fallback placeholders
   * are synthesized in memory only, never written to the Trace). Messages after resume
   * continue in the original Trace file (the file follows the context, not the date),
   * and Token / turn-count stats carry over from their original values.
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

    // Tools and Environment are reassembled from the current Agent State (tool
    // definitions are passed with every Request and aren't part of the history); the
    // system prompt uses the original text recorded in the Trace (identical to the
    // original history); the vault uses current values (it's injected into the
    // subprocess environment, not the history, so a resumed Session should get the
    // latest keys too).
    // The default thinking level comes from the current config chain only (Agent explicit >
    // Project default_chat > built-in "medium", the same configuredThinkingLevel chain
    // createSession uses): session_meta no longer records one (it became a per-turn run
    // parameter), and a `thinking_level` still present in a legacy Trace's meta JSON is
    // deliberately ignored — a resumed legacy subagent session falls back to this Agent's
    // configured level instead of keeping the level it inherited at spawn time.
    const thinkingLevel = this.configuredThinkingLevel();

    const rt = await this.buildRuntime({
      sessionId,
      workspaceDir,
      modelEntry,
      apiKey,
      baseUrl,
      systemPrompt: meta.system_prompt,
      thinkingLevel,
      subagentDepth: 0,
      vault: await loadAgentVault(this.state.root, this.state.projectId, this.state.agentId),
    });

    // History is injected once into the freshly built context object as part of the lazy
    // bootstrap (setHistory is only used on resume); Session cumulative Token counts carry
    // over the same way. The wrap keeps the descriptive error: bad tool arguments in the
    // history (e.g. truncated JSON written by a third-party OpenAI-compatible endpoint)
    // throw a raw SyntaxError during conversion, and the message must indicate Trace
    // history corruption rather than a regular runtime error. With the bootstrap being
    // lazy, that corruption now surfaces on the first run instead of at resume time —
    // the price of a resume that no longer blocks on MCP connects.
    const bootstrap: typeof rt.bootstrap = async () => {
      const r = await rt.bootstrap();
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
      r.llm.sessionTokens = resumed.sessionTokens;
      return r;
    };

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
        await trace.write(compactionEnd({ ...resumed.danglingCompaction, status: "failed" }));
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[trace] interrupted-compaction closure failed: ${detail}\n`);
      }
    }

    return new Session({
      // Invariants only — meta writes never contain a thinking level.
      meta: {
        session_id: sessionId,
        provider: modelEntry.provider,
        model_id: modelEntry.model_id,
        model_context_window: modelEntry.context_window ?? "unknown",
        system_prompt: meta.system_prompt,
        agent_state: this.state.stateDir,
        workspace: workspaceDir,
        // The origin carries over from the original session_meta (a resumed scheduled/subagent
        // Session stays marked). The on-disk value is untrusted: only the exact known origins
        // pass; junk written by a third party is dropped rather than cast through.
        ...(meta.source === "subagent" || meta.source === "schedule"
          ? { source: meta.source }
          : {}),
      },
      bootstrap,
      cancelBootstrap: () => rt.environment.cancelMcpConnect(),
      mcpServers: rt.environment.mcpServerNames(),
      environment: rt.environment,
      trace,
      createLLM: rt.createLLM,
      createBareLLM: rt.createBareLLM,
      compaction: rt.compaction,
      // Where an input image lands when it becomes a path line (see SessionConfig.imagesDir).
      imagesDir: sessionScratchpadDir(
        this.state.root,
        this.state.projectId,
        this.state.agentId,
        sessionId,
      ),
      modelHasVision: modelEntry.vision !== false,
      // Goal mode's control file lives in the session scratchpad; the path is fixed per
      // Session, so it is wired here rather than passed per-run.
      goalFilePath: goalFilePath(
        this.state.root,
        this.state.projectId,
        this.state.agentId,
        sessionId,
      ),
      ...(this.state.systemConfig.max_turns !== undefined
        ? { maxTurns: this.state.systemConfig.max_turns }
        : {}),
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

  /** Id of the most recent Session under the current Agent (determined by the timestamp in session_id); returns null if there is no Session. */
  async latestSessionId(): Promise<string | null> {
    return latestTraceSessionId(
      tracesDir(this.state.root, this.state.projectId, this.state.agentId),
    );
  }

  /**
   * Assemble a Session's runtime components (shared by createSession and
   * resumeSession): the child-Agent runner, Environment and tools, the LLM object
   * and its post-compaction rebuild factory, and the compaction config.
   */
  private async buildRuntime(args: {
    sessionId: string;
    workspaceDir: string;
    /** This Session's Model entry: the caller (createSession / resumeSession) has already validated it exists in the config. */
    modelEntry: ModelEntry;
    apiKey: string | undefined;
    baseUrl: string | undefined;
    systemPrompt: string;
    /** The Session's effective thinking level: the caller resolves the explicit option against the Agent config. */
    thinkingLevel: ThinkingLevelName | undefined;
    subagentDepth: number;
    vault: Record<string, string>;
  }): Promise<{
    environment: Environment;
    /**
     * Lazy session bootstrap, run by Session at the start of the first run: resolves the
     * toolset (the Environment's first listTools connects any configured MCP Servers)
     * and builds the session LLM from it; `mcp` carries the per-server connect outcomes
     * for the mcp_connect_end event. Kept out of createSession on purpose — Session
     * creation stays instant and the run streams connect status while this happens.
     */
    bootstrap: () => Promise<{
      tools: ToolDefinition[];
      llm: GenerativeModel;
      mcp: McpServerConnectResult[];
    }>;
    createLLM: (sessionTokens: TokenCounts) => GenerativeModel;
    createBareLLM: () => GenerativeModel;
    compaction: CompactionSettings;
  }> {
    const {
      sessionId,
      workspaceDir,
      modelEntry,
      apiKey,
      baseUrl,
      systemPrompt,
      thinkingLevel,
      subagentDepth,
      vault,
    } = args;
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
                // A child Agent loads its own vault/config, but the proxy-env policy
                // getter is host policy, not Agent state: the subagent's commands run in
                // the same serving process, so they follow the same settings as the parent's.
                ...(parentAgent.proxyEnv ? { proxyEnv: parentAgent.proxyEnv } : {}),
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
        // otherwise the parent Session's effective thinking level (`thinkingLevel` in scope)
        // is passed down, as a tri-state: `null` when the parent has none, so the child never
        // falls back to its own Agent config (which would otherwise apply on a cross-agent
        // spawn).
        const childSession = await childAgent.createSession({
          workspaceDir,
          ...childModel,
          thinkingLevel: spawnThinkingLevel ?? thinkingLevel ?? null,
          subagentDepth: subagentDepth + 1,
          source: "subagent",
        });
        // All child-session messages are tagged with an origin (the child Session id,
        // prepended as one hop from outer to inner); the first turn forwards the
        // child's session_meta first (including agent_state and other metadata) so the
        // parent frontend can recognize the nested session (for rendering, stats,
        // approval visibility); the parent Trace skips these accordingly (the child
        // Session has its own Trace, linked by session id).
        const hop: MessageOrigin = childSession.sessionId;
        let metaSent = false;
        return {
          sessionId: hop,
          async *run({ prompt, signal, approve }) {
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
            // prompt. Forward the input message itself (origin-tagged, ahead of the run's
            // output) so the live nested view shows the child's user side exactly like a
            // reloaded one (history expansion splices the child Trace, which carries this
            // same message). The parent engine drops origin messages from the parent
            // Trace, so replay never duplicates it. Later rounds (input_subagent
            // follow-up prompts) come through this same generator and are forwarded the
            // same way.
            // sender "agent": in the child's Trace this user turn came from the parent
            // agent (run_subagent's prompt / input_subagent's follow-up), not a human.
            const input = userText(prompt, "agent");
            yield withOrigin(input, hop);
            for await (const msg of childSession.run([input], {
              ...(signal ? { signal } : {}),
              ...(childApprove ? { approve: childApprove } : {}),
            })) {
              yield withOrigin(msg, hop);
            }
          },
          dispose() {
            childSession.dispose();
          },
        };
      },
    };

    // Tool exposure is capped by depth: a (leaf) child Agent that has reached the
    // max spawn depth no longer gets run_subagent, input_subagent or kill_subagent
    // (the latter two depend on the subagent_id produced by the former, so exposing
    // them alone is meaningless).
    const canSpawn = subagentDepth < MAX_SUBAGENT_DEPTH;
    const baseToolConfig = buildToolConfig(this.state);
    // Select tool entries by the session model's type (marked via forModel: vision
    // models use read_image, text-only models use describe_image; entries without
    // this marker are unaffected).
    const modelVision = modelEntry.vision !== false;
    let customTools = selectBuiltinToolsForModel(baseToolConfig.customTools, modelVision);
    if (!canSpawn) {
      customTools = customTools.filter(
        (d) =>
          d.name !== SUBAGENT_NAME &&
          d.name !== INPUT_SUBAGENT_NAME &&
          d.name !== KILL_SUBAGENT_NAME,
      );
    }
    const toolConfig = { ...baseToolConfig, customTools };

    // When the session model doesn't support images (vision=false): inject a vision
    // model service for describe_image (forModel: "text-only", selected by the filter
    // above) — images are described by the Project config's vision_model (a paired
    // reference), and the tool returns text. Even when unconfigured or invalid, it is
    // still injected (modelId=null); the tool then finishes with a failed explanation,
    // and images are never allowed into that session's history.
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

    // Environment binds the Workspace and tool config; the toolset is resolved lazily by
    // the bootstrap below (Session's first run), not here — its first listTools connects
    // any configured MCP Servers, and that wait belongs on the run stream (bracketed by
    // mcp_connect events), not inside createSession. Vault environment variables are
    // injected into command subprocesses (shared by createSession and resumeSession; the
    // caller reads the current agent_state/.vault.toml); a child Agent loads **its
    // own** vault via createAgent rather than inheriting the parent's.
    const environment = new Environment({
      workspaceDir,
      toolConfig,
      // The Session's generic scratchpad root; Environment derives its truncated-tool-output
      // recovery directory from it.
      sessionScratchpadDir: sessionScratchpadDir(
        this.state.root,
        this.state.projectId,
        this.state.agentId,
        sessionId,
      ),
      services: { subagentRunner, ...(visionDescriber ? { visionDescriber } : {}) },
      ...(Object.keys(vault).length > 0 ? { vault } : {}),
      ...(this.proxyEnv ? { proxyEnv: this.proxyEnv } : {}),
    });

    // Configured output cap: the entry's per-model annotation wins over the Agent's
    // system_config value; unset inherits the Agent value. This is a ceiling, not the
    // literal wire value: GenerativeModel clamps each request's effective cap to what the
    // entry's context window can still fit (see llm/context-limits.ts, issue #218), so the
    // seeded per-Agent default (32000) no longer needs a manual per-model override to work
    // against e.g. a 32768-token window — setting the entry's `context_window` is enough.
    const maxTokens = modelEntry.max_tokens ?? this.state.systemConfig.model?.max_tokens;

    // LLM constructor args are extracted into a shared object so they can be reused as-is
    // when rebuilding a new LLM object after compaction (with a fresh model context) — the
    // system prompt and tool definitions aren't part of the compacted history, so the new
    // object keeps them unchanged. The model id sent to AgentHub is always the entry's
    // upstream `model_id` (client_type inference/passing follows it); session_meta, Trace,
    // usage, pricing, and catalog matching all use the (provider, model_id) pair as the
    // primary key. The tool_call_id uniqueness registry is shared with the new LLM rebuilt
    // from llmConfig after compaction: its uniqueness scope is the Session's whole render
    // span, so same-named tool calls after compaction don't collide with earlier cards' ids.
    //
    // The config is completed by `bootstrap` once the toolset is known (listTools may
    // connect MCP Servers); `createLLM` only ever runs after the first run's bootstrap
    // (compaction happens mid-run), so the assertion cannot fire in a legal sequence.
    let llmConfig: GenerativeModelConfig | null = null;
    const bootstrap = async (): Promise<{
      tools: ToolDefinition[];
      llm: GenerativeModel;
      mcp: McpServerConnectResult[];
    }> => {
      const tools = await environment.listTools();
      llmConfig = {
        modelId: modelEntry.model_id,
        toolCallIds: new ToolCallIdAllocator(),
        ...(apiKey !== undefined ? { apiKey } : {}),
        ...(baseUrl !== undefined ? { baseUrl } : {}),
        ...(modelEntry.client_type !== undefined ? { clientType: modelEntry.client_type } : {}),
        tools,
        systemPrompt,
        ...(modelEntry.context_window !== undefined
          ? { contextWindow: modelEntry.context_window }
          : {}),
        ...(maxTokens !== undefined ? { maxTokens } : {}),
        // Fast mode is a session-request annotation: it rides llmConfig (and therefore the
        // post-compaction rebuild), while the bare/meta LLM below and the vision describer
        // deliberately skip it — their background requests gain nothing user-facing from a
        // premium tier, and skipping keeps them working (titles included) even while the
        // annotation is enabled on a model that rejects it.
        ...(modelEntry.fast_mode === true ? { fastMode: true } : {}),
        ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
        ...(this.state.systemConfig.model?.timeoutMs !== undefined
          ? { requestTimeoutMs: this.state.systemConfig.model.timeoutMs }
          : {}),
      };
      return { tools, llm: new GenerativeModel(llmConfig), mcp: environment.mcpConnectResults() };
    };
    const createLLM = (sessionTokens: TokenCounts): GenerativeModel => {
      if (llmConfig === null) {
        throw new Error("createLLM called before the session bootstrap resolved the toolset");
      }
      const next = new GenerativeModel(llmConfig);
      // Carries over the Session's cumulative Token counts, so token_usage.session stays continuous across compaction.
      next.sessionTokens = sessionTokens;
      return next;
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

    // Compaction config: defaults are filled in here; an unknown mode falls back to summarize (the default).
    const compactionConfig = this.state.systemConfig.compaction;
    const compaction: CompactionSettings = {
      maxContextLength: effectiveMaxContextLength(
        compactionConfig?.max_context_length ?? 128000,
        modelEntry.context_window,
      ),
      maxSessionTurns: compactionConfig?.max_session_turns ?? -1,
      mode: compactionConfig?.mode === "discard" ? "discard" : "summarize",
      prompt: compactionConfig?.prompt ?? DEFAULT_COMPACTION_PROMPT,
    };

    return { environment, bootstrap, createLLM, createBareLLM, compaction };
  }
}
