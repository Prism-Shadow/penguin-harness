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
import {
  abortEvent,
  buildBackgroundTaskDoneMessage,
  mcpConnectBegin,
  mcpConnectEnd,
  sessionMeta,
  toolListReady,
  userText,
} from "./omnimessage/index.js";
import type {
  McpServerConnectResult,
  OmniMessage,
  SessionMetaPayload,
  TokenCounts,
  ToolDefinition,
} from "./omnimessage/index.js";
import { imagesToScratchpadPaths } from "./internal/session-support.js";
import { runGoalLoop } from "./goal/goal-loop.js";
import { goalFinishedOf } from "./goal/goal-stream.js";
import type {
  BackgroundCommandInfo,
  BackgroundTaskDoneEvent,
  EnvironmentInterface,
  LLMInterface,
  ToolPermission,
} from "./interfaces.js";
import { generateTitleWithLLM } from "./internal/session-title.js";
import type { SessionTitleResult } from "./internal/session-title.js";
import { compactAvailability, ContextEngine } from "./engine/context-engine.js";
import type {
  CompactAvailability,
  CompactionSettings,
  EngineInitialState,
  RunOptions,
  TraceSink,
} from "./engine/context-engine.js";

export interface SessionConfig {
  /** Session metadata — per-session invariants only (session_id / provider / model_id / model_context_window / system_prompt / agent_state / workspace / source); the toolset travels separately as the first run's tool_list_ready event. */
  meta: SessionMetaPayload;
  /**
   * Lazy session bootstrap, run at the start of the first run: resolves the toolset —
   * the Environment's first listTools connects any configured MCP Servers — and builds
   * the session LLM from it; `mcp` carries the per-server connect outcomes for the
   * mcp_connect_end event. Kept out of Session construction so creating a Session is
   * instant and the connect wait streams as visible events instead. An aborted attempt
   * is cancelled via `cancelBootstrap` — the next run calls this again and reconnects
   * from scratch.
   */
  bootstrap: () => Promise<{
    tools: ToolDefinition[];
    llm: LLMInterface;
    mcp: McpServerConnectResult[];
  }>;
  /** Cancels an in-flight bootstrap on user abort (the composition layer wires Environment.cancelMcpConnect). */
  cancelBootstrap?: () => void;
  /** Names of the configured MCP Servers (config order): non-empty brackets the bootstrap in mcp_connect_begin/end events; empty emits none. */
  mcpServers: string[];
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
 * Awaits `work` unless `signal` aborts first — the abort side never cancels `work`
 * (deliberate: see the bootstrap single-flight). Settles immediately when the signal is
 * already aborted.
 */
function raceAbort<T>(
  work: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<{ value: T } | "aborted"> {
  if (!signal) return work.then((value) => ({ value }));
  if (signal.aborted) return Promise.resolve("aborted");
  return new Promise((resolve, reject) => {
    const onAbort = (): void => resolve("aborted");
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve({ value });
      },
      (err: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
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
 * A background-task completion event as the harness user message that reports it: the
 * `[background_task_done]` block carries the structured facts, the body the display text —
 * what settled, then the tail of its yet-undelivered output. `sender: "harness"` marks the
 * non-human origin in the Trace.
 */
function backgroundDoneNotice(event: BackgroundTaskDoneEvent): OmniMessage {
  const what = event.kind === "command" ? "Background command" : "Background subagent";
  const idField = event.kind === "command" ? "process_id" : "subagent_id";
  const verb = event.status === "completed" ? "finished" : "failed";
  const detail = event.detail ? ` — ${event.detail}` : "";
  const head = `${what} ${verb}: \`${event.label}\` (${idField} ${event.id})${detail}`;
  const body = event.output.trim() ? `${head}\n\n${event.output}` : head;
  return userText(
    buildBackgroundTaskDoneMessage(
      { kind: event.kind, id: event.id, status: event.status, detail: event.detail },
      body,
    ),
    "harness",
  );
}

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

  /** Built by the first run's bootstrap (`ensureReady`); null until then — the sync delegates below answer conservatively before it exists. */
  private engine: ContextEngine | null = null;
  /**
   * Inputs of a run aborted mid-bootstrap, carried into the next run: the engine did not
   * exist yet to deliver them — dropping them would silently lose the user's message.
   * Prepended on the next run so the model finally sees them.
   */
  private carryOverInput: OmniMessage[] = [];
  /**
   * Serialized envelopes of carried inputs the ABORT path already wrote to the Trace
   * (the aborted turn is recorded: input + connect pair + abort). The next run's engine
   * re-delivers those inputs but must not re-write them — consumed one-shot by the
   * skip-wrapper handed to the engine at construction.
   */
  private carryOverPersisted: string[] = [];
  /** The aborted attempt's yielded records (connect pair + abort event), stashed by ensureReady for the caller's Trace write. */
  private abortedBootstrapRecords: OmniMessage[] = [];
  private readonly bootstrap: SessionConfig["bootstrap"];
  private readonly cancelBootstrap: (() => void) | undefined;
  private readonly mcpServers: string[];
  /** Engine dependencies minus the LLM (which the bootstrap provides); kept whole so ensureReady can construct the engine late. */
  private readonly engineDeps: Omit<
    ConstructorParameters<typeof ContextEngine>[0],
    "llm" | "toolList" | "bootstrapRecords"
  >;
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
  /**
   * Background-task completion notices not yet delivered (harness user messages built from
   * the Environment's completion events). Single source of truth for delivery: a running
   * Task's engine drains it at every input-assembly boundary (yield + Trace write + request
   * input); an idle Session fires `noticeListener` so the host can take the queue
   * (`takeBackgroundNotices`) and submit it as an ordinary task — whichever consumes first,
   * each notice is delivered exactly once. With neither, the next run's start drains it.
   */
  private pendingNotices: OmniMessage[] = [];
  /** Idle-arrival signal for the host (see `onBackgroundNotice`); null until a host subscribes. */
  private noticeListener: (() => void) | null = null;
  /** Live background-subagent message subscriber (see `onBackgroundMessage`); null until a host subscribes — messages are display copies and drop without one. */
  private bgMessageListener: ((msg: OmniMessage) => void) | null = null;

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
    this.bootstrap = config.bootstrap;
    this.cancelBootstrap = config.cancelBootstrap;
    this.mcpServers = config.mcpServers;
    // The engine itself is built by ensureReady() on the first run, once the bootstrap has
    // produced the LLM: everything else it needs is captured here.
    this.engineDeps = {
      environment: config.environment,
      ...(config.trace ? { trace: config.trace } : {}),
      ...(config.maxTurns !== undefined ? { maxTurns: config.maxTurns } : {}),
      // Context compaction: new LLM factory + resolved settings + writes session_meta (and
      // tool_list_ready) at the start of the new Trace file after splitting.
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
      // Background completion notices: the engine pulls from the Session's queue at every
      // input-assembly boundary (see pendingNotices for the exactly-once contract).
      backgroundNotices: {
        drain: () => this.pendingNotices.splice(0),
        pending: () => this.pendingNotices.length,
      },
    };
    // Completion events of run_in_background launches flow from the Environment into the
    // notice queue (events fired before this attach are buffered by the Environment).
    config.environment.setBackgroundTaskListener?.((event) => this.handleBackgroundDone(event));
    // Live-forwarded background-subagent messages flow straight to the host's subscriber —
    // display copies only (the child's own Trace is the durable record), so with no
    // subscriber they are simply dropped.
    config.environment.setBackgroundMessageListener?.((msg) => this.bgMessageListener?.(msg));
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
    // A previously aborted bootstrap dropped these before the engine existed: they lead
    // this run's input (already folded by their own run), so the model finally sees them
    // and the engine's run-start write persists them.
    if (this.carryOverInput.length > 0) {
      newMessages = [...this.carryOverInput, ...newMessages];
      this.carryOverInput = [];
    }
    const ready = yield* this.ensureReady(opts?.signal);
    if (!ready) {
      // Aborted mid-bootstrap: the attempt is cancelled (cancelBootstrap) and the next
      // run reconnects from scratch. The aborted turn still leaves a Trace — the input,
      // the aborted connect pair and the abort event — so the analysis page shows the
      // interruption and a reload (or restart) does not lose the message. The engine
      // doesn't exist, so the Session writes them itself; inputs already persisted by a
      // previous aborted attempt are skipped (repeat aborts record each exactly once),
      // and the next successful run's engine skips re-writing them (carryOverPersisted).
      for (const m of newMessages) {
        const serialized = JSON.stringify(m);
        if (this.carryOverPersisted.includes(serialized)) continue;
        if (await this.writeTrace(m, "aborted-run input")) {
          this.carryOverPersisted.push(serialized);
        }
      }
      for (const m of this.abortedBootstrapRecords) {
        await this.writeTrace(m, "aborted bootstrap record");
      }
      this.abortedBootstrapRecords = [];
      // Carry the merged list, so repeated aborts keep accumulating exactly once each.
      this.carryOverInput = newMessages;
      return;
    }
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
    for await (const msg of this.engine!.run(newMessages, opts)) {
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
   * First-run bootstrap: writes `session_meta`, resolves the toolset and builds the
   * engine — streaming the phase as it happens. With MCP Servers configured, the connect
   * + discovery wait is bracketed by one `mcp_connect_begin` / `mcp_connect_end` pair
   * (overall status + per-server outcomes; the wall time is the pair's timestamp
   * difference). The resolved toolset then flows as one `tool_list_ready` event — split
   * out of session_meta precisely so the meta never has to wait for this phase.
   *
   * The three messages are yielded live here, but their Trace writes are DEFERRED to the
   * engine (ContextEngineDeps.bootstrapRecords): the engine writes them right after this
   * run's input, so the connect phase belongs to the new turn in the Trace — after the
   * user's message — instead of dangling before it (their earlier timestamps keep the
   * file chronological, since the input message was created before the connect began).
   *
   * Returns false when `signal` aborts mid-bootstrap: the attempt is CANCELLED
   * (`cancelBootstrap` → the provider aborts pending connects and resets — the next run
   * reconnects from scratch), the pair closes with `status: "aborted"`, and a standard
   * abort event follows. The aborted records are stashed (abortedBootstrapRecords) for
   * the caller, which writes the turn to the Trace itself — input first, then the pair
   * and the abort — since no engine exists to do it; the input is also carried
   * (carryOverInput) so the next run delivers it to the model without re-writing it.
   * No-op returning true once the engine exists; a rejected
   * bootstrap (unreadable resume history, LLM construction) throws to the caller, and a
   * later run retries with a fresh attempt.
   */
  private async *ensureReady(signal?: AbortSignal): AsyncGenerator<OmniMessage, boolean> {
    await this.ensureMetaWritten();
    if (this.engine) return true;
    const records: OmniMessage[] = [];
    if (this.mcpServers.length > 0) {
      const begin = mcpConnectBegin(this.mcpServers);
      yield begin;
      records.push(begin);
    }
    const work = this.bootstrap();
    const outcome = await raceAbort(work, signal);
    if (outcome === "aborted") {
      this.cancelBootstrap?.();
      // The cancelled attempt settles on its own (rejection expected); keep it from
      // surfacing as an unhandled rejection.
      work.catch(() => {});
      // Stashed (not written here) so the caller can put the run's INPUT first — the
      // Trace stays chronological: input, pair, abort.
      this.abortedBootstrapRecords = records.length > 0 ? [...records] : [];
      if (this.mcpServers.length > 0) {
        const end = mcpConnectEnd({ status: "aborted", results: [] });
        yield end;
        this.abortedBootstrapRecords.push(end);
      }
      const aborted = abortEvent("user");
      yield aborted;
      this.abortedBootstrapRecords.push(aborted);
      return false;
    }
    const { tools, llm, mcp } = outcome.value;
    if (this.mcpServers.length > 0) {
      const end = mcpConnectEnd({
        status: mcp.some((r) => r.status !== "completed") ? "failed" : "completed",
        results: mcp,
      });
      yield end;
      records.push(end);
    }
    const toolsMsg = toolListReady(tools);
    yield toolsMsg;
    // One-shot skip list: inputs carried from an aborted bootstrap were already written
    // to the Trace by the abort path — the engine re-delivers them (model context) but
    // must not re-write them. Exact-envelope match, each consumed once.
    const persisted = this.carryOverPersisted;
    this.carryOverPersisted = [];
    const baseTrace = this.engineDeps.trace;
    const trace: TraceSink | undefined =
      baseTrace && persisted.length > 0
        ? {
            write: async (msg) => {
              const at = persisted.indexOf(JSON.stringify(msg));
              if (at >= 0) {
                persisted.splice(at, 1);
                return;
              }
              await baseTrace.write(msg);
            },
            ...(baseTrace.rotate ? { rotate: () => baseTrace.rotate!() } : {}),
          }
        : baseTrace;
    // toolsMsg rides as `toolList` alone (first-run write + rotation rewrite); the
    // records array carries only the connect pair — one message, one carrier.
    this.engine = new ContextEngine({
      ...this.engineDeps,
      ...(trace !== undefined ? { trace } : {}),
      llm,
      toolList: toolsMsg,
      bootstrapRecords: records,
    });
    return true;
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
    // No engine yet = no running Task to steer (the first run's bootstrap hasn't finished).
    return this.engine?.steer(input) ?? false;
  }

  /**
   * Withdraws a steering input queued via `steer` before the engine delivers it: `input` is
   * the exact list that was passed to `steer` (matched by identity). Returns false when it
   * is no longer queued — already delivered to the model, or the run exited — so the host
   * reports "already delivered" instead of silently pretending the recall worked.
   */
  unsteer(input: OmniMessage[]): boolean {
    return this.engine?.unsteer(input) ?? false;
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
    // No engine yet = no reconnect wait can be in progress.
    return this.engine?.skipReconnectWait() ?? false;
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
    if (!this.engine) {
      // Nothing compactable and no engine: stay a strict no-op, without bootstrapping — a
      // session that never ran must not leave trace records (meta / tool_list_ready) behind,
      // or an untouched session would look resumable.
      if (this.compactability() !== "ok") return;
      // A Session resumed after a restart is the opposite case: its history is real and
      // already on disk, and the engine simply has not been built yet (that happens on the
      // first run). Build it here — the bootstrap injects the replayed history into the LLM,
      // so the compaction request folds the actual conversation — rather than silently doing
      // nothing and leaving the user waiting for a banner that never arrives.
      const ready = yield* this.ensureReady(opts?.signal);
      if (!ready) {
        // Aborted mid-bootstrap: no engine exists to write the records, so the Session writes
        // them itself (as runTask does), keeping the interruption visible in the Trace.
        for (const m of this.abortedBootstrapRecords) {
          await this.writeTrace(m, "aborted bootstrap record");
        }
        this.abortedBootstrapRecords = [];
        return;
      }
    }
    yield* this.engine!.compact(opts);
  }

  /**
   * Whether compaction is possible, and why not if not (see ContextEngine.compactability).
   * When the result isn't `ok`, `compact()` is a no-op and yields no messages — callers should
   * give feedback based on this rather than triggering a silent, fruitless compaction.
   */
  compactability(): CompactAvailability {
    if (this.engine) return this.engine.compactability();
    // No engine yet: it is built by the first run's bootstrap (ensureReady). For a Session
    // created in this process that genuinely means an empty context, but a Session **resumed**
    // after a process restart already carries what the Trace replay recovered — answer from
    // that, or a user who just restarted the client is told their whole conversation has
    // nothing to compact (the server renders this reason as a 409 `nothing_to_compact`).
    const init = this.engineDeps.initialState;
    return compactAvailability({
      configured: Boolean(this.engineDeps.compaction && this.engineDeps.createLLM),
      sessionTurns: init?.sessionTurns ?? 0,
      fromCompaction: init?.fromCompaction ?? false,
    });
  }

  /** Writes `session_meta` to the Trace before the first run/compaction; best-effort — failure doesn't interrupt the run. */
  private async ensureMetaWritten(): Promise<void> {
    if (this.metaWritten) return;
    await this.writeTrace(this.meta, "session_meta");
    this.metaWritten = true;
  }

  /** Best-effort `session_meta` Trace write (warn-and-continue stance): a failure logs and never interrupts the run. */
  private async writeTrace(msg: OmniMessage, label: string): Promise<boolean> {
    if (!this.trace) return false;
    try {
      await this.trace.write(msg);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[trace] ${label} write failed: ${message}\n`);
      return false;
    }
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

  /** Refreshes the listen-port probes behind `BackgroundCommandInfo.serviceUrl` (see EnvironmentInterface.probeBackgroundCommandServices). No-op for environments without it. */
  async probeBackgroundCommandServices(): Promise<void> {
    await this.environment.probeBackgroundCommandServices?.();
  }

  /** Kills one of this Session's background command processes (whole process group); false when the id is unknown. */
  killBackgroundCommand(processId: string): boolean {
    return this.environment.killBackgroundCommand?.(processId) ?? false;
  }

  /** Queues a background completion event as a harness user notice; a running Task delivers it at the next boundary, otherwise the host is signaled (see pendingNotices). */
  private handleBackgroundDone(event: BackgroundTaskDoneEvent): void {
    this.pendingNotices.push(backgroundDoneNotice(event));
    if (!(this.engine?.isTaskRunning ?? false)) this.noticeListener?.();
  }

  /**
   * Subscribes the host's idle-arrival signal for background completion notices: called
   * (without payload) whenever a notice is queued while no Task is running. The host then
   * takes the queue with `takeBackgroundNotices` and submits it as an ordinary task — a host
   * that never subscribes still gets delivery on the next run's start. One listener; a later
   * call replaces the earlier one.
   */
  onBackgroundNotice(listener: () => void): void {
    this.noticeListener = listener;
  }

  /**
   * Takes the queued background completion notices (harness user messages) for submission as
   * a task's input. Empties the queue — the caller owns delivery of what it took; anything
   * queued after this call is signaled/drained separately.
   */
  takeBackgroundNotices(): OmniMessage[] {
    return this.pendingNotices.splice(0);
  }

  /** Whether completion notices are still queued (hosts use it to keep a Session's runtime entry alive until they are delivered). */
  hasPendingBackgroundNotices(): boolean {
    return this.pendingNotices.length > 0;
  }

  /**
   * Subscribes the host to live-forwarded background-subagent messages (origin-tagged, the
   * same stream a foreground collect window would relay): the server publishes them to the
   * session's event channel so the frontend sees a background child working in real time.
   * One listener; a later call replaces the earlier one.
   */
  onBackgroundMessage(listener: (msg: OmniMessage) => void): void {
    this.bgMessageListener = listener;
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
