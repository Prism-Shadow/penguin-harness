/**
 * Session — a continuous conversation context under the same Agent and Workspace.
 *
 * Human is the SDK's input/output boundary: there is no "Human
 * implementation/interface".
 *   - Input: the OmniMessage list (Prompt) passed to `run(newMessages, opts?)`, plus the abort
 *     signal `signal` and the per-call approval callback `approve` in `opts`;
 *   - Output: `run` streams OmniMessage via an async generator.
 *
 * Approval is a **within-turn interaction**: as soon as a tool_call finishes streaming, `approve`
 * is requested immediately, and it executes if allowed. Approvals for multiple tools happen one
 * at a time, but execution doesn't block the generation/approval of subsequent tools (execution
 * can overlap). GenerativeModel maintains history across turns/Tasks. A Task ends when a turn no
 * longer produces a tool_call (final reply).
 *
 * Rendering tool calls is not Session/core's responsibility: the CLI / Web frontend renders it
 * from the streamed OmniMessage on its own.
 * Docs: /docs/agent-loop; /docs/interfaces § "The Human boundary".
 */
import { sessionMeta } from "./omnimessage/index.js";
import type { OmniMessage, SessionMetaPayload, TokenCounts } from "./omnimessage/index.js";
import { imagesToScratchpadPaths } from "./internal/session-support.js";
import type { EnvironmentInterface, LLMInterface, ToolPermission } from "./interfaces.js";
import { generateTitleWithLLM } from "./internal/session-title.js";
import type { SessionTitleResult } from "./internal/session-title.js";
import { ContextEngine } from "./engine/context-engine.js";
import type {
  CompactAvailability,
  CompactionSettings,
  EngineInitialState,
  RunOptions,
  TraceSink,
} from "./engine/context-engine.js";

export interface SessionConfig {
  /** Session metadata (session_id / provider / model_id / model_context_window / system_prompt / tools / thinking_level / agent_state / workspace). */
  meta: SessionMetaPayload;
  llm: LLMInterface;
  environment: EnvironmentInterface;
  trace?: TraceSink;
  /** Maximum LLM turns per Task (default 100; -1 removes the cap). */
  maxTurns?: number;
  /** Creates a new LLM object after compaction (carries over the Session's accumulated Token count); context compaction is unavailable if not provided. */
  createLLM?: (sessionTokens: TokenCounts) => LLMInterface;
  /**
   * Factory for the bare LLM used by out-of-band, one-off requests (same Model/credential as
   * the session; no tools, no system prompt, thinking off): used for meta-requests such as
   * `generateTitle`; if not provided, `generateTitle` returns null.
   */
  createBareLLM?: () => LLMInterface;
  /** Context compaction settings (defaults are filled in by the composition layer); only takes effect when provided together with `createLLM`. */
  compaction?: CompactionSettings;
  /** Session resume: `session_meta` is already in the original Trace file, so it isn't written again on the first run (avoids duplication). */
  metaAlreadyWritten?: boolean;
  /** Session resume: the engine's initial state derived from Trace replay (carry-over / accumulated stats, etc.). */
  initialEngineState?: EngineInitialState;
  /** Session resume: the full historical messages of the current context (for rendering, including interrupted turns and their markers), for frontend display. */
  resumedHistory?: OmniMessage[];
  /**
   * Set when the session's model doesn't support images (the composition layer decides this via
   * ModelEntry.vision): images in `run` input are saved to this directory (the session's
   * scratchpad), and the path is appended to the user text instead — the model views the image
   * via describe_image, and images never enter the session history directly (some providers
   * return a 400 outright on image input).
   */
  inputImagesDir?: string;
}

/**
 * Caps on captured title material (chars per side); accumulation stops once exceeded. The
 * assistant body is capped tighter: a title only needs the opening of the answer, and hosts
 * may start generating as soon as this much body text has streamed (see the Web server's
 * early trigger) — a long answer would otherwise overrun the material.
 */
const TITLE_USER_MATERIAL_LIMIT = 2000;
const TITLE_ASSISTANT_MATERIAL_LIMIT = 1000;

/**
 * Accumulates title material: the body text of complete text messages from the main session
 * (no origin) — thinking and tool calls naturally don't count — and stops once the cap is hit.
 */
function appendTitleText(
  base: string,
  msg: OmniMessage,
  role: "user" | "assistant",
  limit: number,
): string {
  if (base.length >= limit) return base;
  if (msg.origin && msg.origin.length > 0) return base;
  const p = msg.payload as { type?: string; role?: string; text?: string };
  if (msg.type !== "model_msg" || p.type !== "text" || p.role !== role || !p.text) return base;
  return base ? `${base}\n${p.text}` : p.text;
}

export class Session {
  readonly sessionId: string;
  /** The session model's provider group (paired with `modelId` to form the model reference). */
  readonly provider: string;
  /** The session model's upstream model_id (the request id sent to AgentHub). */
  readonly modelId: string;
  readonly workspaceDir: string;
  /** Session resume: the full historical messages of the current context (for rendering); undefined for a non-resumed Session. */
  readonly resumedHistory?: OmniMessage[];

  private readonly engine: ContextEngine;
  private readonly environment: EnvironmentInterface;
  private readonly trace?: TraceSink;
  private readonly meta: OmniMessage;
  private readonly createBareLLM?: () => LLMInterface;
  private readonly inputImagesDir?: string;
  private metaWritten = false;
  /** Title material (used by `generateTitle` as the default): the user input and model body text of the first Task that contains user text. */
  private titleUserText = "";
  private titleAssistantText = "";
  /** Material-frozen flag: becomes true once the first Task containing user text finishes; subsequent runs stop accumulating. */
  private titleMaterialFrozen = false;

  constructor(config: SessionConfig) {
    this.sessionId = config.meta.session_id;
    this.provider = config.meta.provider;
    this.modelId = config.meta.model_id;
    this.workspaceDir = config.meta.workspace;
    this.environment = config.environment;
    this.trace = config.trace;
    this.meta = sessionMeta(config.meta);
    this.metaWritten = config.metaAlreadyWritten ?? false;
    if (config.resumedHistory) this.resumedHistory = config.resumedHistory;
    if (config.createBareLLM) this.createBareLLM = config.createBareLLM;
    if (config.inputImagesDir) this.inputImagesDir = config.inputImagesDir;
    this.engine = new ContextEngine({
      llm: config.llm,
      environment: config.environment,
      ...(config.trace ? { trace: config.trace } : {}),
      ...(config.maxTurns !== undefined ? { maxTurns: config.maxTurns } : {}),
      // Context compaction: new LLM factory + resolved settings + writes session_meta at the start of the new Trace file after splitting.
      ...(config.createLLM ? { createLLM: config.createLLM } : {}),
      ...(config.compaction ? { compaction: config.compaction } : {}),
      ...(config.initialEngineState ? { initialState: config.initialEngineState } : {}),
      sessionMeta: this.meta,
    });
  }

  /**
   * Runs a Task to completion and streams out OmniMessage. `newMessages` is this call's Prompt
   * (only the newly added input); `opts` carries the abort signal `signal` and the per-call
   * approval callback `approve` (the engine calls it once per tool_call within a turn).
   * On the first run, `session_meta` is written to the Trace first.
   *
   * A single `run` automatically drives the whole ReAct loop: consuming the LLM stream,
   * approving and executing tools one at a time, feeding results back for the next turn,
   * until a turn no longer produces a tool_call (Task ends) or it's aborted.
   * Docs: /docs/agent-loop § "The loop at a glance".
   */
  async *run(newMessages: OmniMessage[], opts?: RunOptions): AsyncGenerator<OmniMessage> {
    // Model doesn't support images: input images are saved to disk first (session scratchpad),
    // then the path is appended to the text before it reaches the engine/Trace.
    if (this.inputImagesDir) {
      newMessages = await imagesToScratchpadPaths(newMessages, this.inputImagesDir);
    }
    await this.ensureMetaWritten();
    // Self-captures title material (the title is derived from the first-turn
    // conversation text): while material isn't frozen yet, collect this call's user text and
    // the produced model text; freezes once the first Task containing user text finishes, so
    // the title reflects the start of the conversation.
    const capture = !this.titleMaterialFrozen;
    if (capture) {
      for (const m of newMessages) {
        this.titleUserText = appendTitleText(
          this.titleUserText,
          m,
          "user",
          TITLE_USER_MATERIAL_LIMIT,
        );
      }
    }
    for await (const msg of this.engine.run(newMessages, opts)) {
      if (capture) {
        this.titleAssistantText = appendTitleText(
          this.titleAssistantText,
          msg,
          "assistant",
          TITLE_ASSISTANT_MATERIAL_LIMIT,
        );
      }
      yield msg;
    }
    if (capture && this.titleUserText.trim()) this.titleMaterialFrozen = true;
  }

  /**
   * Queues a steering message for the running Task: the engine appends it to the next
   * completed tool output as a `[user_steering]` block (or, if the turn ends without tool
   * calls first, delivers it as the next user turn), so the model sees it without the loop
   * being interrupted. Returns false when no Task is running — the host should then submit
   * the text as a normal task instead. Rides on tool outputs regardless of approval mode;
   * anything still queued when the run exits (abort included) is discarded.
   */
  steer(text: string): boolean {
    return this.engine.steer(text);
  }

  /**
   * User-initiated request to compact context (e.g. a CLI command): reuses the automatic
   * compaction flow but skips the threshold check (reason=manual). Only callable at Task
   * boundaries (between runs); streams out paired `compaction` events. The summarize digest
   * becomes the prefix of the next `run`'s input (merged with the next user Prompt). A no-op
   * if compaction isn't configured.
   * Docs: /docs/agent-loop § "Compaction".
   */
  async *compact(opts?: { signal?: AbortSignal }): AsyncGenerator<OmniMessage> {
    yield* this.engine.compact(opts);
  }

  /**
   * Whether compaction is possible, and why not if not (see ContextEngine.compactability).
   * When the result isn't `ok`, `compact()` is a no-op and yields no messages — callers should
   * give feedback based on this rather than triggering a silent, fruitless compaction.
   */
  compactability(): CompactAvailability {
    return this.engine.compactability();
  }

  /** Writes `session_meta` to the Trace before the first run/compaction; best-effort — failure doesn't interrupt the run. */
  private async ensureMetaWritten(): Promise<void> {
    if (this.metaWritten) return;
    if (this.trace) {
      try {
        await this.trace.write(this.meta);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[trace] session_meta write failed: ${message}\n`);
      }
    }
    this.metaWritten = true;
  }

  /**
   * Out-of-band, one-off request that generates a short title from the first-turn conversation
   * text: sends one request using the bare LLM for the session's Model (no
   * tools, no system prompt, thinking off), **without writing history or Trace**. Material
   * defaults to the first Task text self-captured by the Session (user input and model body
   * text collected during run; thinking and tool calls don't count), so callers don't need to
   * supply it; `material` can override this (e.g. when a host generates a title for a
   * sub-session — the material is that sub-session's own conversation). `title` is null if the
   * material is empty, the request fails, or the composition layer didn't supply a bare LLM
   * factory. Token consumption is returned via `usage` for the host to account for.
   * Docs: /docs/agent-loop § "Side channels".
   */
  async generateTitle(args?: {
    /** Material override; defaults to the Session's self-captured material. */
    material?: { userText: string; assistantText: string };
    signal?: AbortSignal;
  }): Promise<SessionTitleResult> {
    if (!this.createBareLLM) return { title: null, usage: null };
    const material = args?.material ?? {
      userText: this.titleUserText,
      assistantText: this.titleAssistantText,
    };
    return generateTitleWithLLM(this.createBareLLM(), {
      ...material,
      ...(args?.signal ? { signal: args.signal } : {}),
    });
  }

  /** Queries a tool's permission level (for the frontend to determine permission mode); returns undefined for unknown tools. */
  toolPermission(name: string): ToolPermission | undefined {
    return this.environment.toolPermission(name);
  }

  /** This Session's session_meta message (used e.g. by host tools to forward nested-session metadata to a parent session). */
  get metaMessage(): OmniMessage {
    return this.meta;
  }

  /**
   * Releases runtime resources held by the Session: kills long-running command sessions
   * managed by the Environment. The host calls this when the Session ends (CLI exit, Web
   * session close) to avoid leaking background processes into the host process's lifetime.
   * Optional, idempotent.
   */
  dispose(): void {
    this.environment.dispose?.();
  }
}
