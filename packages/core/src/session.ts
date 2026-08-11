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
import { runGoalLoop } from "./goal/goal-loop.js";
import { goalFinishedOf } from "./goal/goal-stream.js";
import type {
  BackgroundCommandInfo,
  EnvironmentInterface,
  LLMInterface,
  ToolPermission,
} from "./interfaces.js";
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
  /** Session metadata — per-session invariants only (session_id / provider / model_id / model_context_window / system_prompt / tools / agent_state / workspace / source). */
  meta: SessionMetaPayload;
  llm: LLMInterface;
  environment: EnvironmentInterface;
  trace?: TraceSink;
  /** Maximum LLM turns per Task; -1 removes the cap. Omitted means -1 too — the agent-config default and the SDK fallback agree (unlimited). */
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
   * This Session's scratchpad directory: where an input image is saved when it becomes an
   * `[attached image: <path>]` line instead of riding the request as an image. The model
   * reads it back with describe_image / read_image, and the Web turns the path into a
   * thumbnail again. Always set — each input path decides on its own whether to use it.
   */
  imagesDir: string;
  /**
   * Whether the session's model accepts image input (from ModelEntry.vision). Prompts and
   * steering messages fold their images only when this is false; goal objectives fold either
   * way, since they are re-injected as text every round (see `runGoal`).
   */
  modelHasVision: boolean;
  /**
   * Absolute path of this Session's GOAL.yaml (the composition layer derives it from the
   * agent scratchpad — see `goalFilePath` in state/paths.ts). Goal mode
   * (`run(input, { goal })`) is unavailable without it.
   */
  goalFilePath?: string;
}

/** Options of a goal-mode `run` (`opts.goal`): present = the input starts a goal loop. */
export interface GoalRunOptions {
  /** Token budget; omitted or -1 (`UNLIMITED_BUDGET`) means no budget. */
  budget?: number;
  /** Hard cap on rounds — a runaway backstop, not a host knob (default 100; -1 disables; see goal-loop.ts). */
  maxRounds?: number;
}

/** `Session.run` options: the engine's per-call options, plus goal mode. */
export type SessionRunOptions = RunOptions & { goal?: GoalRunOptions };

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
  private readonly imagesDir: string;
  private readonly modelHasVision: boolean;
  private readonly goalFile?: string;
  private metaWritten = false;
  /**
   * The image fold, bound to this Session's scratchpad — Session is the layer that knows both
   * the directory and the model's capability, so it binds the conversion once and each input
   * path calls it under its own rule (see `modelHasVision`). The body reads `imagesDir` at call
   * time, so field ordering in the constructor doesn't matter.
   */
  private readonly foldImages = (messages: OmniMessage[]): Promise<OmniMessage[]> =>
    imagesToScratchpadPaths(messages, this.imagesDir);
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
    this.imagesDir = config.imagesDir;
    this.modelHasVision = config.modelHasVision;
    if (config.goalFilePath) this.goalFile = config.goalFilePath;
    this.engine = new ContextEngine({
      llm: config.llm,
      environment: config.environment,
      ...(config.trace ? { trace: config.trace } : {}),
      ...(config.maxTurns !== undefined ? { maxTurns: config.maxTurns } : {}),
      // Context compaction: new LLM factory + resolved settings + writes session_meta at the start of the new Trace file after splitting.
      ...(config.createLLM ? { createLLM: config.createLLM } : {}),
      ...(config.compaction ? { compaction: config.compaction } : {}),
      ...(config.initialEngineState ? { initialState: config.initialEngineState } : {}),
      // The engine assembles one input of its own — a steering message with images — and folds
      // it through the same converter `runTask` uses, failures included: a scratchpad that
      // can't be written to ends the run rather than dropping the attachment and carrying on.
      // The picture usually arrives BECAUSE the run is going the wrong way, so continuing
      // without it spends the rest of the Task heading further that way. A vision model simply
      // isn't given the function, which is all the engine needs to know about the subject.
      ...(config.modelHasVision ? {} : { foldInputImages: this.foldImages }),
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
   *
   * With `opts.goal` present, the same call runs **goal mode**: the input's text becomes the
   * objective (attached images fold into `[attached image: …]` lines within it, whatever the
   * model's vision — see `runGoal`), and the Session loops Tasks — each round's input is the
   * `[goal]` protocol block followed by the text (round 1 verbatim, later rounds the objective)
   * — until the goal file says stop, the budget runs out, or a round is cut off. Round inputs are
   * yielded onto the stream before each round (a plain run never yields its own input), and
   * the final message is exactly one `goal_finished` event carrying the outcome.
   * Docs: /docs/goal-mode.
   */
  async *run(newMessages: OmniMessage[], opts?: SessionRunOptions): AsyncGenerator<OmniMessage> {
    if (opts?.goal) {
      // Rounds run with the caller's per-call options minus `goal` (each round is a plain Task).
      const { goal, ...roundOpts } = opts;
      yield* this.runGoal(newMessages, goal, roundOpts);
      return;
    }
    yield* this.runTask(newMessages, opts);
  }

  /** The single-Task path (a goal round runs one of these per round). */
  private async *runTask(
    newMessages: OmniMessage[],
    opts?: RunOptions,
  ): AsyncGenerator<OmniMessage> {
    // Folded before Trace and title material, so the path lines are what gets recorded.
    if (!this.modelHasVision) newMessages = await this.foldImages(newMessages);
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
   * The goal-mode branch of `run`: validates the input, folds any attached images into the
   * objective, then drives the goal loop, running each round through the single-Task path with
   * the same per-call options (approval, signal, thinking level). The loop's terminal
   * `goal_finished` event is additionally written to the Trace (best-effort, like session_meta)
   * so the goal's end survives with its conversation.
   *
   * Images fold here whether or not the model has vision, because the objective is re-injected
   * as the text of every round's `[goal]` block — an image message has nowhere to sit in that.
   * Sending it in round 1 alone would leave later rounds pointing at something compaction has
   * since dropped, while the objective still reads correct; a path line survives every round
   * and every compaction, and the model pays for the picture only when it looks. The lines go
   * at the end of the text, where goal-loop's `stripLeadingMarkerBlocks` leaves them alone.
   *
   * Text is required and checked before the fold: a picture alone doesn't state a goal.
   */
  private async *runGoal(
    newMessages: OmniMessage[],
    goal: GoalRunOptions,
    opts: RunOptions,
  ): AsyncGenerator<OmniMessage> {
    if (!this.goalFile) {
      throw new Error("Goal mode is unavailable: this Session has no goal file path configured.");
    }
    const isUserText = (m: OmniMessage): boolean => {
      const p = m.payload as { type?: string; role?: string; text?: string };
      return m.type === "model_msg" && p.type === "text" && p.role === "user" && !!p.text?.trim();
    };
    // The objective itself. Checked before the fold, which only ever appends to a user text —
    // so once this passes, the joined text below cannot come out empty.
    if (!newMessages.some(isUserText)) {
      throw new Error("Goal mode requires a non-empty text objective.");
    }
    const folded = await this.foldImages(newMessages);
    const texts: string[] = [];
    for (const m of folded) {
      const p = m.payload as { type?: string; role?: string; text?: string };
      // The fold has already turned the images into text, so anything left that isn't user
      // text was never one of the two kinds goal mode accepts.
      if (m.type !== "model_msg" || p.type !== "text" || p.role !== "user" || !p.text) {
        throw new Error("Goal mode accepts user text and images only (the objective).");
      }
      texts.push(p.text);
    }
    const text = texts.join("\n").trim();
    const loop = runGoalLoop(
      { run: (msgs) => this.runTask(msgs, opts) },
      {
        text,
        goalFilePath: this.goalFile,
        ...(goal.budget !== undefined ? { budget: goal.budget } : {}),
        ...(goal.maxRounds !== undefined ? { maxRounds: goal.maxRounds } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
    );
    for await (const msg of loop) {
      if (goalFinishedOf(msg) && this.trace) {
        try {
          await this.trace.write(msg);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          process.stderr.write(`[trace] goal_finished write failed: ${message}\n`);
        }
      }
      yield msg;
    }
  }

  /**
   * Queues a steering message for the running Task: the engine delivers it between turns as
   * a standalone `[user_steering]` user message — sent with the next request input alongside
   * that turn's tool outputs, or alone as the continuation input when the turn produced no
   * tool calls — so the model sees it without the loop being interrupted. `input` is an
   * OmniMessage list, the same shape `run` takes a Prompt in: its user text becomes the
   * block's body, and its images ride behind that message just as a Prompt's do; on a model
   * without vision they become `[attached image: …]` path lines inside the block instead (see
   * the engine's steeringMessages). Returns false when no Task is running — the host should
   * then submit the message as a normal task instead. Delivery is independent of approval
   * mode; anything still queued when the run exits (abort included) is discarded.
   */
  steer(input: OmniMessage[]): boolean {
    return this.engine.steer(input);
  }

  /**
   * Skips the in-progress reconnect backoff and fires the next retry immediately (the
   * user's "retry now" on the reconnect countdown): the attempt counter is unchanged —
   * the skipped wait does not consume an extra attempt. Returns false (a benign no-op)
   * when no reconnect wait is in progress; idempotent under races with the timer/abort.
   * Mirrors `steer` as a mid-run nudge (no message of its own — the effect surfaces as
   * the next `request_begin` arriving early).
   */
  skipReconnectWait(): boolean {
    return this.engine.skipReconnectWait();
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
   * Background command processes owned by this Session's Environment (exec_commands
   * promoted past their yield window): the host UI's process list. Empty for
   * environments that don't track any.
   */
  listBackgroundCommands(): BackgroundCommandInfo[] {
    return this.environment.listBackgroundCommands?.() ?? [];
  }

  /** Kills one of this Session's background command processes (whole process group); false when the id is unknown. */
  killBackgroundCommand(processId: string): boolean {
    return this.environment.killBackgroundCommand?.(processId) ?? false;
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
