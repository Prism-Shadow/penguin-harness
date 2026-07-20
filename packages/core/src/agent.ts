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
  loadAgentVault,
  loadOrInitAgentState,
  loadProjectConfig,
  projectDir,
  resolveModelRef,
  scratchpadDir,
  systemConfigPath,
  tracesDir,
  type AgentState,
  type ModelRef,
  type ProjectConfig,
} from "./state/index.js";
import { GenerativeModel, ToolCallIdAllocator } from "./llm/index.js";
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
import { userText, withOrigin } from "./omnimessage/index.js";
import type {
  MessageOrigin,
  OmniMessage,
  TokenCounts,
  ToolCallPayload,
} from "./omnimessage/index.js";
import { SUBAGENT_NAME } from "./environment/tools/run-subagent.js";
import { INPUT_SUBAGENT_NAME } from "./environment/tools/input-subagent.js";
import type { CompactionSettings } from "./engine/context-engine.js";
import type {
  GenerativeModelConfig,
  SubagentRunner,
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
}

export interface CreateSessionOptions {
  /** Workspace for this run; if unspecified, a temporary Workspace is created under the Agent directory. */
  workspaceDir?: string;
  /** Model used for this Session (upstream model_id); if unspecified, uses the Project's default Model. */
  modelId?: string;
  /**
   * Provider grouping for `modelId` (a paired reference); if omitted, resolved via
   * `resolveModelRef` semantics — `model_id` only resolves if it is a globally unique
   * exact match in the config; zero or multiple matches produce a clear error.
   */
  provider?: string;
  /** Explicit credentials; if unspecified, falls back to credentials in the Project config, then to AgentHub reading environment variables. */
  apiKey?: string;
  baseUrl?: string;
  /** Internal use: this Session's depth in the subagent spawn chain (0 at the top level), used to cap spawn depth. */
  subagentDepth?: number;
}

export interface ResumeSessionOptions {
  /** Id of the Session to resume. */
  sessionId: string;
  /** Explicit credentials; if unspecified, falls back to credentials in the Project config, then to AgentHub reading environment variables. */
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Effective compaction threshold: capped at 75% of the model's `context_window` —
 * the threshold must stay well below the hard window limit, otherwise small-window
 * models get rejected by the provider (a non-retryable 400) before compaction even
 * triggers, and the compaction request itself (old context + prompt + summary output)
 * also needs headroom. Not clamped when `<=0` (disabled) or the window is unknown.
 */
export function effectiveMaxContextLength(configured: number, contextWindow: unknown): number {
  if (configured <= 0) return configured;
  if (typeof contextWindow !== "number") return configured;
  return Math.min(configured, Math.floor(contextWindow * 0.75));
}

/** Create or load an Agent. */
export async function createAgent(opts: CreateAgentOptions = {}): Promise<Agent> {
  const state = await loadOrInitAgentState(opts);
  const projectConfig = await loadProjectConfig(state.root, state.projectId);
  return new Agent(state, projectConfig);
}

export class Agent {
  constructor(
    readonly state: AgentState,
    readonly projectConfig: ProjectConfig,
  ) {}

  /**
   * Create a Session in the specified (or a temporary) Workspace.
   * Docs: /docs/sessions-and-traces § "Run model".
   */
  async createSession(opts: CreateSessionOptions = {}): Promise<Session> {
    // Model is validated first (before creating the Workspace, so failure leaves no
    // temp directory behind): the reference must resolve to an entry in the Project
    // config (the (provider, model_id) pair is the unique key); a reference
    // outside the config throws immediately rather than passing silently — otherwise
    // credentials, pricing, and the context window would all be unavailable.
    if (opts.modelId === undefined && opts.provider !== undefined) {
      throw new Error(
        "provider was specified without modelId: a model reference must be given as a pair (provider cannot be used alone).",
      );
    }
    let ref: ModelRef;
    if (opts.modelId !== undefined) {
      // The only entry point for resolving an "omitted provider" reference (resolveModelRef): three branches — unique match / zero matches / ambiguous.
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
    // the wrong location); a temp Workspace is only created when unspecified.
    let workspaceDir: string;
    if (opts.workspaceDir) {
      workspaceDir = path.resolve(opts.workspaceDir);
      let stat;
      try {
        stat = await fs.stat(workspaceDir);
      } catch {
        throw new Error(
          `Workspace does not exist: ${workspaceDir}. Specify an existing directory, or omit the Workspace to use a temporary directory.`,
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

    // Agent-level vault (agent_state/.vault.toml) and installed Skills: read the current values each time a Session is created.
    const vault = await loadAgentVault(this.state.root, this.state.projectId, this.state.agentId);
    const installedSkills = await listInstalledSkills(
      this.state.root,
      this.state.projectId,
      this.state.agentId,
    );

    // The assembled system prompt goes both to the LLM and into session_meta (so the
    // Trace can audit the actual effective value). The vault only injects **key names**
    // into the prompt (so the model knows which API keys are available); values only
    // go into the subprocess environment. Skills only inject metadata (name and
    // description); the model reads the body on demand via shell.
    const systemPrompt = assembleSystemPrompt(
      this.state,
      sessionEnvironment(workspaceDir, sessionId, {
        agentId: this.state.agentId,
        projectDir: projectDir(this.state.root, this.state.projectId),
      }),
      Object.keys(vault),
      installedSkills,
    );

    const rt = await this.buildRuntime({
      workspaceDir,
      modelEntry,
      apiKey,
      baseUrl,
      systemPrompt,
      subagentDepth,
      vault,
    });

    const trace = new Writer({
      tracesDir: tracesDir(this.state.root, this.state.projectId, this.state.agentId),
      sessionId,
    });

    return new Session({
      meta: {
        session_id: sessionId,
        provider: modelEntry.provider,
        model_id: modelEntry.model_id,
        model_context_window: modelEntry.context_window ?? "unknown",
        system_prompt: systemPrompt,
        tools: rt.tools,
        thinking_level: this.state.systemConfig.model?.thinking_level ?? "default",
        agent_state: this.state.stateDir,
        workspace: workspaceDir,
      },
      llm: rt.llm,
      environment: rt.environment,
      trace,
      createLLM: rt.createLLM,
      createBareLLM: rt.createBareLLM,
      compaction: rt.compaction,
      // Model doesn't support images: input images are written to the session scratchpad and their paths appended to the text (viewed via describe_image).
      ...(modelEntry.vision === false
        ? {
            inputImagesDir: path.join(
              scratchpadDir(this.state.root, this.state.projectId, this.state.agentId),
              sessionId,
            ),
          }
        : {}),
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
    const rt = await this.buildRuntime({
      workspaceDir,
      modelEntry,
      apiKey,
      baseUrl,
      systemPrompt: meta.system_prompt,
      subagentDepth: 0,
      vault: await loadAgentVault(this.state.root, this.state.projectId, this.state.agentId),
    });

    // History is injected once into a fresh context object (setHistory is only used
    // on resume); Session cumulative Token counts carry over. Wrap the error
    // descriptively: bad tool arguments in the history (e.g. truncated JSON written by
    // a third-party OpenAI-compatible endpoint) throw a raw SyntaxError during
    // conversion, so the error must indicate Trace history corruption rather than a
    // regular runtime error.
    if (resumed.history.length > 0) {
      try {
        rt.llm.setHistory(resumed.history);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Resume failed: the Trace history could not be injected (records may be corrupted, e.g. invalid tool-argument JSON): ${detail}`,
        );
      }
    }
    rt.llm.sessionTokens = resumed.sessionTokens;

    // Continue writing to the original Trace file (the Trace only records real messages; synthesized paired placeholders are re-emitted in memory alongside carry-over).
    const trace = new Writer({
      tracesDir: dir,
      sessionId,
      dateDir: located.dateDir,
      startIndex: located.index,
    });

    return new Session({
      meta: {
        session_id: sessionId,
        provider: modelEntry.provider,
        model_id: modelEntry.model_id,
        model_context_window: modelEntry.context_window ?? "unknown",
        system_prompt: meta.system_prompt,
        tools: rt.tools,
        thinking_level: this.state.systemConfig.model?.thinking_level ?? "default",
        agent_state: this.state.stateDir,
        workspace: workspaceDir,
      },
      llm: rt.llm,
      environment: rt.environment,
      trace,
      createLLM: rt.createLLM,
      createBareLLM: rt.createBareLLM,
      compaction: rt.compaction,
      // Model doesn't support images: input images are written to the session scratchpad and their paths appended to the text (viewed via describe_image).
      ...(modelEntry.vision === false
        ? {
            inputImagesDir: path.join(
              scratchpadDir(this.state.root, this.state.projectId, this.state.agentId),
              sessionId,
            ),
          }
        : {}),
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
    workspaceDir: string;
    /** This Session's Model entry: the caller (createSession / resumeSession) has already validated it exists in the config. */
    modelEntry: ModelEntry;
    apiKey: string | undefined;
    baseUrl: string | undefined;
    systemPrompt: string;
    subagentDepth: number;
    vault: Record<string, string>;
  }): Promise<{
    environment: Environment;
    tools: ToolDefinition[];
    llm: GenerativeModel;
    createLLM: (sessionTokens: TokenCounts) => GenerativeModel;
    createBareLLM: () => GenerativeModel;
    compaction: CompactionSettings;
  }> {
    const { workspaceDir, modelEntry, apiKey, baseUrl, systemPrompt, subagentDepth, vault } = args;
    // Child-Agent runner: injected into the run_subagent tool so it doesn't need to
    // depend on Agent/Session (breaking a circular dependency). The model can
    // optionally choose agentId (omitted = call the current Agent) and modelId
    // (omitted = Project default). Precheck errors (depth limit exceeded / agent
    // doesn't exist) are expressed as throws, which the Environment collapses to failed.
    // Docs: /docs/interfaces § "Subagent interfaces"
    const parentAgent = this;
    const { root, projectId, agentId: parentAgentId } = this.state;
    const subagentRunner: SubagentRunner = {
      // Spawn and run are separate: the same child Session can run for multiple turns
      // (continuing via input_subagent appending a prompt); resource cleanup is
      // consolidated in handle.dispose (called by the managing ManagedSubagentSession).
      async spawn({ agentId, modelId }) {
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
            ? await createAgent({ root, projectId, agentId })
            : parentAgent;
        const childSession = await childAgent.createSession({
          workspaceDir,
          ...(modelId !== undefined ? { modelId } : {}),
          subagentDepth: subagentDepth + 1,
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
            for await (const msg of childSession.run([userText(prompt)], {
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
    // max spawn depth no longer gets run_subagent or input_subagent (the latter
    // depends on the subagent_id produced by the former, so exposing it alone is
    // meaningless).
    const canSpawn = subagentDepth < MAX_SUBAGENT_DEPTH;
    const baseToolConfig = buildToolConfig(this.state);
    // Select tool entries by the session model's type (marked via forModel: vision
    // models use read_image, text-only models use describe_image; entries without
    // this marker are unaffected).
    const modelVision = modelEntry.vision !== false;
    let customTools = selectBuiltinToolsForModel(baseToolConfig.customTools, modelVision);
    if (!canSpawn) {
      customTools = customTools.filter(
        (d) => d.name !== SUBAGENT_NAME && d.name !== INPUT_SUBAGENT_NAME,
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
              maxTokens: 2048,
              requestTimeoutMs: 60_000,
            }),
        };
      } else {
        visionDescriber = { modelId: null };
      }
    }

    // Environment binds the Workspace and tool config; tools are listed first so
    // GenerativeModel can be initialized. Vault environment variables are injected
    // into command subprocesses (shared by createSession and resumeSession; the
    // caller reads the current agent_state/.vault.toml); a child Agent loads **its
    // own** vault via createAgent rather than inheriting the parent's.
    const environment = new Environment({
      workspaceDir,
      toolConfig,
      services: { subagentRunner, ...(visionDescriber ? { visionDescriber } : {}) },
      ...(Object.keys(vault).length > 0 ? { vault } : {}),
    });
    const tools = await environment.listTools();

    // LLM constructor args are extracted into a constant so they can be reused as-is when
    // rebuilding a new LLM object after compaction (with a fresh model context) — the system
    // prompt and tool definitions aren't part of the compacted history, so the new object keeps
    // them unchanged. The model id sent to AgentHub is always the entry's upstream `model_id`
    // (client_type inference/passing follows it); session_meta, Trace, usage, pricing, and catalog
    // matching all use the (provider, model_id) pair as the primary key.
    // The tool_call_id uniqueness registry is shared with the new LLM rebuilt from llmConfig after
    // compaction: its uniqueness scope is the Session's whole render span, so same-named tool calls
    // after compaction don't collide with earlier tool cards' ids.
    const llmConfig: GenerativeModelConfig = {
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
      ...(this.state.systemConfig.model?.max_tokens !== undefined
        ? { maxTokens: this.state.systemConfig.model.max_tokens }
        : {}),
      ...(this.state.systemConfig.model?.thinking_level !== undefined
        ? { thinkingLevel: this.state.systemConfig.model.thinking_level }
        : {}),
      ...(this.state.systemConfig.model?.timeoutMs !== undefined
        ? { requestTimeoutMs: this.state.systemConfig.model.timeoutMs }
        : {}),
    };
    const llm = new GenerativeModel(llmConfig);
    const createLLM = (sessionTokens: TokenCounts): GenerativeModel => {
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
        maxTokens: 300,
        requestTimeoutMs: 30_000,
      });

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

    return { environment, tools, llm, createLLM, createBareLLM, compaction };
  }
}
