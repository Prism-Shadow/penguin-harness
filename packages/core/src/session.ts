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
  mcpConnectEnd,
  sessionMeta,
  userText,
} from "./omnimessage/index.js";
import type {
  OmniMessage,
  SessionMetaMessage,
  SessionMetaPayload,
  StopReason,
} from "./omnimessage/index.js";
import { stripLeadingMarkerBlocks } from "./omnimessage/markers/index.js";
import type { ModelRef } from "./state/project-config.js";
import { sameModelRef } from "./state/project-config.js";
import { imagesToScratchpadPaths } from "./internal/session-support.js";
import { runStopHooks } from "./hooks/stop-hook.js";
import type { HookSubagentSpawner, SessionHooks, StopHook } from "./hooks/stop-hook.js";
import { runPreToolUseHooks } from "./hooks/tool-hook.js";
import type { PreToolUseHook } from "./hooks/tool-hook.js";
import { runUserPromptHooks } from "./hooks/prompt-hook.js";
import type { UserPromptHook, UserPromptHookResult } from "./hooks/prompt-hook.js";
import { pumpOpener } from "./internal/merge-queue.js";
import type {
  ApproveFn,
  RunCutoff,
  BackgroundCommandInfo,
  BackgroundSubagentInfo,
  SubagentMessageOptions,
  SubagentMessageOutcome,
  BackgroundTaskDoneEvent,
  EnvironmentInterface,
  LLMInterface,
  ThinkingLevelName,
  ToolDetachResult,
  ToolPermission,
} from "./interfaces/index.js";
import { vetoForToolCall, withCommandPolicy } from "./internal/command-policy.js";
import type { CommandPolicySource } from "./internal/command-policy.js";
import { generateTitleWithLLM } from "./internal/session-title.js";
import type { SessionTitleResult } from "./internal/session-title.js";
import { compactAvailability, ContextEngine } from "./engine/context-engine.js";
import type {
  CompactAvailability,
  CompactionSettings,
  EngineInitialState,
  OpenContextOptions,
  OpenedContext,
  RunOptions,
  TraceSink,
} from "./engine/context-engine.js";

/**
 * A context as the composition layer opens it for a Session: the engine's
 * {@link OpenedContext}, plus the hooks that context runs with. Hook packages are read when
 * a model context opens, like the rest of the Agent State, so a rotation brings its own
 * set; the engine never sees them. Nor does it see whether the context's model has vision:
 * the image fold is the Session's own.
 */
export interface SessionOpenedContext extends OpenedContext {
  /** The opened context's hooks, replacing the Session's whole set. Absent = the Session keeps the ones it has (an embedder that registered in-process hooks and rotates without re-reading any). */
  hooks?: SessionHooks;
  /** Whether the opened context's model accepts image input (see SessionConfig.modelHasVision). Absent = as before. */
  modelHasVision?: boolean;
}

/**
 * What `SessionConfig.openNextContext` is called with: the engine's options, plus the model a
 * switch in flight opens the context on (see {@link Session.switchModel}) — absent for every
 * other rotation, which keeps the model the closing context ran on. The opener resolves the
 * reference against the Project config as it is on disk.
 */
export interface SessionOpenContextOptions extends OpenContextOptions {
  modelRef?: ModelRef;
}

export interface SessionConfig {
  /** Session metadata: the first context's runtime configuration (session_id / provider / model_id / model_context_window / system_prompt / agent_state / workspace / source) — a context a compaction or a model switch opens brings its own through `openNextContext`; the toolset travels separately as the first run's tool_list_ready event. */
  meta: SessionMetaPayload;
  /**
   * Opens the Session's FIRST context, lazily at the start of the first run: resolves the
   * toolset — the Environment's first listTools connects any configured MCP Servers — and
   * builds that context's LLM. The records it produces on the way — the
   * `mcp_connect_begin` / `mcp_connect_end` pair around a connect, then the
   * `tool_list_ready` carrying the toolset — are published through `opts.emit` and stream
   * live from `run`: the same shape as `openNextContext`, because opening the first context
   * and opening a later one are one procedure in the composition layer. Kept out of
   * Session construction so creating a Session is instant and the connect wait streams as
   * visible events instead. An aborted attempt is cancelled via `cancelBootstrap` — the
   * next run calls this again and reconnects from scratch.
   */
  bootstrap: (opts: OpenContextOptions) => Promise<{ llm: LLMInterface }>;
  /** Cancels an in-flight bootstrap on user abort (the composition layer wires Environment.cancelMcpConnect). */
  cancelBootstrap?: () => void;
  environment: EnvironmentInterface;
  trace?: TraceSink;
  /** Maximum LLM turns per Task in the first context; -1 removes the cap. Omitted means -1 too — the agent-config default and the SDK fallback agree (unlimited). A context `openNextContext` opens brings its own. */
  maxTurns?: number;
  /**
   * Opens a fresh model context after compaction (see ContextEngineDeps.openNextContext): the new
   * LLM object, with the session_meta and engine settings of the context it opened — the
   * composition layer assembles them from the Agent State as it is then — and the records it
   * produced while opening (its MCP connect pair and tool_list_ready, through `opts.emit`).
   * The Session adopts the meta as its current one (`metaMessage`); the engine yields the
   * records live, writes meta and records at the head of the rotated Trace file, and seeds
   * the new LLM's cumulative session counts itself. Context compaction is unavailable if not
   * provided. The hooks it answers with become the Session's (see
   * {@link SessionOpenedContext}).
   */
  openNextContext?: (
    opts: SessionOpenContextOptions,
  ) => SessionOpenedContext | Promise<SessionOpenedContext>;

  /**
   * Factory for the bare LLM used by out-of-band, one-off requests (same Model/credential as
   * the session; no tools, no system prompt, thinking off): used for meta-requests such as
   * `generateTitle`; if not provided, `generateTitle` returns null.
   */
  createBareLLM?: () => LLMInterface;
  /** The first context's compaction settings (defaults are filled in by the composition layer); only takes effect when provided together with `openNextContext`, and a context that one opens brings its own. */
  compaction?: CompactionSettings;
  /** Live compaction settings, re-read at every compaction checkpoint (see ContextEngineDeps.readCompaction): what lets a threshold, mode or prompt edited on disk reach the conversation that is running. Session-lifetime, so a rotation does not replace it. */
  readCompaction?: () => CompactionSettings | Promise<CompactionSettings>;
  /** Session resume: `session_meta` is already in the original Trace file, so it isn't written again on the first run (avoids duplication). */
  metaAlreadyWritten?: boolean;
  /** Session resume: the engine's initial state derived from Trace replay (carry-over / accumulated stats, etc.). */
  initialEngineState?: EngineInitialState;
  /** Session resume: the full historical messages of the current context (for rendering, including interrupted turns and their markers), for frontend display. */
  resumedHistory?: OmniMessage[];
  /**
   * This Session's scratchpad directory: where an input image is saved when it becomes an
   * `[attached image: <path>]` line instead of riding the request as an image. The model
   * reads it back with read_file, and the Web turns the path into a
   * thumbnail again. Always set — each input path decides on its own whether to use it.
   */
  imagesDir: string;
  /**
   * Whether the first context's model accepts image input (from ModelEntry.vision). Prompts and
   * steering messages fold their images only while the running context's model has none — a
   * context `openNextContext` opens brings its own answer (SessionOpenedContext.modelHasVision).
   */
  modelHasVision: boolean;
  /**
   * The composition layer's half of an in-session model switch (see {@link Session.switchModel});
   * absent = the Session's model cannot be switched.
   */
  modelSwitch?: ModelSwitchSupport;
  /**
   * The first context's hooks — one list per hook point, and the spawner that honors a stop
   * hook's `subagent` answer (see hooks/stop-hook.ts). Absent = none. A context
   * `openNextContext` opens may bring its own.
   */
  hooks?: SessionHooks;
  /**
   * Project sandbox command policy (`[command_policy]` of `.project_config.toml`), as a
   * SOURCE answering with the running context's policy: command policy is strict-tier —
   * the composition layer reads it from disk once per context open, so an edit applies at
   * the next rotation. `run` wraps the injected approval callback with it — the refusal
   * happens at the approval boundary, above every approval mode and below no Human
   * implementation.
   * Absent, or a source yielding nothing = the factory rule set applies;
   * `{ enabled: false }` opts out. Docs: /docs/configuration § "Command policy".
   */
  commandPolicy?: CommandPolicySource;
}

/** `Session.run` options: the engine's per-call options. */
export type SessionRunOptions = RunOptions;

/** Why a model switch was refused before its first event (see {@link ModelSwitchRefusedError}). */
export type ModelSwitchRefusal =
  /** The target pair names no entry in the Project config on disk. */
  | "model_not_configured"
  /** The target is configured but its client cannot be constructed (a missing credential foremost), or this Session has no switch support. */
  | "model_unavailable"
  /** The Session has a context to close but no compaction configured to close it with. */
  | "compaction_not_configured";

/**
 * A model switch refused before anything was sent or recorded: no event was produced and the
 * Session is exactly where it was. `Session.switchModel` throws it for the refusals `reason`
 * enumerates, so a host maps each to its own code (the server's 409s) and treats anything
 * else a switch throws as a failure.
 */
export class ModelSwitchRefusedError extends Error {
  constructor(
    readonly reason: ModelSwitchRefusal,
    message: string,
  ) {
    super(message);
    this.name = "ModelSwitchRefusedError";
  }
}

/**
 * What the composition layer provides for {@link Session.switchModel}: the Session owns the
 * policy, the Agent owns the Project config, the credentials and the assembly.
 */
export interface ModelSwitchSupport {
  /**
   * Validates a switch target before anything is sent or recorded: resolves it against the
   * Project config as it is on disk and constructs its client, so a pair that is not
   * configured, or has no credential, is refused here (a {@link ModelSwitchRefusedError})
   * exactly where Session creation would have failed.
   */
  validate(ref: ModelRef): Promise<void>;
  /**
   * Re-assembles the Session's not-yet-opened first context on `ref` — the switch of a Session
   * that never ran, which has no context to close. The Environment is re-equipped for it, and
   * what comes back is what a rotation's opener returns minus the LLM, which the first run's
   * bootstrap builds as usual.
   */
  reassembleInitialContext(ref: ModelRef): Promise<Omit<SessionOpenedContext, "llm">>;
}

/** `Session.switchModel` options: the target's paired reference, and the abort signal for the compaction request. */
export interface ModelSwitchOptions {
  provider: string;
  modelId: string;
  signal?: AbortSignal;
}

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
 *
 * Built at DELIVERY time, not queue time, because the message must record how it reached the
 * conversation and a queued event does not know that yet: the engine's mid-run drain stamps
 * `delivery: "steering"` (injected into an already-started Task — the render and stats layers
 * keep it inside that turn), while the host's idle take leaves the field off (the notice is
 * the new task's own starting input and keeps its independent turn). The two deliveries are
 * positionally identical in the Trace, so only this recorded stamp can tell them apart.
 */
function backgroundDoneNotice(event: BackgroundTaskDoneEvent, delivery?: "steering"): OmniMessage {
  const what = event.kind === "command" ? "Background command" : "Background subagent";
  const idField = event.kind === "command" ? "process_id" : "subagent_id";
  const verb =
    event.status === "completed" ? "finished" : event.status === "stopped" ? "stopped" : "failed";
  const detail = event.detail ? ` — ${event.detail}` : "";
  const head = `${what} ${verb}: \`${event.label}\` (${idField} ${event.id})${detail}`;
  const body = event.output.trim() ? `${head}\n\n${event.output}` : head;
  return userText(
    buildBackgroundTaskDoneMessage(
      {
        kind: event.kind,
        id: event.id,
        status: event.status,
        detail: event.detail,
        ...(delivery ? { delivery } : {}),
      },
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
  /**
   * Engine dependencies, kept so ensureReady can construct the engine late — minus what only
   * that moment knows: the LLM and its records (the bootstrap provides them), and the first
   * context's session_meta (the Session's own `meta` as it stands then).
   */
  private readonly engineDeps: Omit<
    ConstructorParameters<typeof ContextEngine>[0],
    "llm" | "toolList" | "bootstrapRecords" | "sessionMeta"
  >;
  private readonly environment: EnvironmentInterface;
  private readonly trace?: TraceSink;
  /** session_meta of the context that is running: the first context's at construction, re-stamped by each context `openNextContext` opens (see `metaMessage`); `provider` / `modelId` read from it. */
  private meta: SessionMetaMessage;
  private readonly createBareLLM?: () => LLMInterface;
  /** The Session's thinking level — buffered here until the engine exists, engine state afterwards (see the `thinkingLevel` accessors). */
  private level?: ThinkingLevelName;
  private readonly imagesDir: string;
  /** Whether the running context's model views images itself (see SessionConfig.modelHasVision); follows each context `openNextContext` opens. */
  private modelHasVision: boolean;
  private readonly modelSwitch: ModelSwitchSupport | undefined;
  /** The model a switch in flight opens the next context on: what the opener is told (see `switchModel`). */
  private switchTarget: ModelRef | undefined;
  /**
   * The hooks of the context that is running, and the spawner for a stop hook's subagent
   * answer: the first context's at construction, replaced whole by each context
   * `openNextContext` opens with a set of its own (see `adoptHooks`). Every consult reads
   * these fields when it happens, so a rotation in the middle of a `run` call hands the
   * rest of that call to the new context's hooks.
   */
  private stopHooks: readonly StopHook[] = [];
  private preToolUseHooks: readonly PreToolUseHook[] = [];
  private userPromptHooks: readonly UserPromptHook[] = [];
  private spawnSubagent: HookSubagentSpawner | undefined;
  private readonly commandPolicy?: CommandPolicySource;
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
   * Background-task completion events not yet delivered. Single source of truth for
   * delivery: a running Task's engine drains it at every input-assembly boundary (yield +
   * Trace write + request input); an idle Session fires `noticeListener` so the host can
   * take the queue (`takeBackgroundNotices`) and submit it as an ordinary task — whichever
   * consumes first, each notice is delivered exactly once. With neither, the next run's
   * start drains it. The queue holds raw EVENTS: the harness user message is built by the
   * consuming path, which is when the delivery mode is known (see backgroundDoneNotice —
   * the engine drain stamps `delivery: steering`, the host take does not).
   */
  private pendingNotices: BackgroundTaskDoneEvent[] = [];
  /** Idle-arrival signal for the host (see `onBackgroundNotice`); null until a host subscribes. */
  private noticeListener: (() => void) | null = null;
  /** Live background-subagent message subscriber (see `onBackgroundMessage`); null until a host subscribes — messages are display copies and drop without one. */
  private bgMessageListener: ((msg: OmniMessage) => void) | null = null;

  constructor(config: SessionConfig) {
    this.sessionId = config.meta.session_id;
    this.workspaceDir = config.meta.workspace;
    this.environment = config.environment;
    this.trace = config.trace;
    this.meta = sessionMeta(config.meta);
    this.metaWritten = config.metaAlreadyWritten ?? false;
    if (config.resumedHistory) this.resumedHistory = config.resumedHistory;
    if (config.createBareLLM) this.createBareLLM = config.createBareLLM;

    this.imagesDir = config.imagesDir;
    this.modelHasVision = config.modelHasVision;
    this.modelSwitch = config.modelSwitch;
    if (config.hooks) this.adoptHooks(config.hooks);
    if (config.commandPolicy) this.commandPolicy = config.commandPolicy;
    this.bootstrap = config.bootstrap;
    this.cancelBootstrap = config.cancelBootstrap;
    // The engine itself is built by ensureReady() on the first run, once the bootstrap has
    // produced the LLM: everything else it needs is captured here.
    this.engineDeps = {
      environment: config.environment,
      ...(config.trace ? { trace: config.trace } : {}),
      ...(config.maxTurns !== undefined ? { maxTurns: config.maxTurns } : {}),
      // Context compaction: the new-context factory + resolved settings; the engine writes the
      // context's session_meta (and tool_list_ready) at the start of the new Trace file after
      // splitting. The factory is wrapped so the opener is told the model a switch in flight is
      // moving to, and the Session follows the opened context (see `adoptContext`).
      ...(config.openNextContext
        ? {
            openNextContext: async (opts: OpenContextOptions): Promise<OpenedContext> => {
              const { hooks, modelHasVision, ...opened } = await config.openNextContext!({
                ...opts,
                ...(this.switchTarget ? { modelRef: this.switchTarget } : {}),
              });
              this.adoptContext(opened.sessionMeta, modelHasVision, hooks);
              return opened;
            },
          }
        : {}),
      ...(config.compaction ? { compaction: config.compaction } : {}),
      ...(config.readCompaction ? { readCompaction: config.readCompaction } : {}),
      ...(config.initialEngineState ? { initialState: config.initialEngineState } : {}),
      // The engine assembles one input of its own — a steering message with images — and folds
      // it through the same converter `runTask` uses, failures included: a scratchpad that
      // can't be written to ends the run rather than dropping the attachment and carrying on.
      // The picture usually arrives BECAUSE the run is going the wrong way, so continuing
      // without it spends the rest of the Task heading further that way. A model that takes
      // images is answered `null` — the model can change with the context, so the question is
      // asked each time.
      foldInputImages: async (messages) => (this.modelHasVision ? null : this.foldImages(messages)),
      // Background completion notices: the engine pulls from the Session's queue at every
      // input-assembly boundary (see pendingNotices for the exactly-once contract). This is
      // the steering delivery path — the notice joins a Task that already exists — so the
      // built message carries the `delivery: steering` stamp.
      backgroundNotices: {
        drain: () => this.pendingNotices.splice(0).map((e) => backgroundDoneNotice(e, "steering")),
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
   * Runs the named package's host-triggered `user_prompt` hook (`trigger: "host"`) — hooks
   * run in core and nowhere else; the host calls this when it accepts a user prompt for the
   * flow the package owns (the server does for a goal start, with `extras: { budget }`).
   * The Session supplies its own id, Trace path and scratchpad directory; the answer's
   * `context` is the text the host sends right behind the user's message, stamped
   * `sender: "harness"`. Returns null when the package is not installed or names no such
   * command (the host's cue to refuse the flow); an empty answer is `{}`. No `hook` event
   * is recorded — the expansion message is the record.
   */
  async runUserPromptHook(
    name: string,
    prompt: string,
    extras?: Record<string, string | number | boolean>,
  ): Promise<UserPromptHookResult | null> {
    const hook = this.userPromptHooks.find((h) => h.name === name && h.trigger === "host");
    if (!hook) return null;
    const tracePath = this.trace?.currentPath?.();
    const result = await hook.run({
      sessionId: this.sessionId,
      ...(tracePath !== undefined ? { tracePath } : {}),
      scratchpadDir: this.imagesDir,
      prompt,
      ...(extras !== undefined ? { extras } : {}),
    });
    return result ?? {};
  }

  /** Takes a context's hooks as the Session's own, whole: a point the set does not list has none. */
  private adoptHooks(hooks: SessionHooks): void {
    this.stopHooks = hooks.stop ?? [];
    this.preToolUseHooks = hooks.preToolUse ?? [];
    this.userPromptHooks = hooks.userPrompt ?? [];
    this.spawnSubagent = hooks.spawnSubagent;
  }

  /**
   * The user-prompt consult of one Prompt (the engine's `RunOptions.userPrompt` seam): runs
   * the hooks due on every Prompt against the text of the user's own in `input`, and
   * returns their records. Null — nothing to consult — when no such hook is installed or
   * the input carries no user text without a sender: an input the harness, the server or a
   * parent agent wrote is not a Prompt the user submitted.
   */
  private async consultUserPromptHooks(
    input: OmniMessage[],
    signal?: AbortSignal,
  ): Promise<{ records: OmniMessage[] } | null> {
    const hooks = this.userPromptHooks.filter((h) => h.trigger !== "host");
    if (hooks.length === 0) return null;
    const texts: string[] = [];
    for (const msg of input) {
      if (msg.type !== "model_msg" || (msg.origin && msg.origin.length > 0)) continue;
      const p = msg.payload as { type?: string; role?: string; text?: string; sender?: string };
      if (p.type !== "text" || p.role !== "user" || typeof p.text !== "string") continue;
      if (p.sender !== undefined && p.sender !== "user") continue;
      texts.push(p.text);
    }
    if (texts.length === 0) return null;
    const text = texts.join("\n");
    const tracePath = this.trace?.currentPath?.();
    return runUserPromptHooks(hooks, {
      sessionId: this.sessionId,
      ...(tracePath !== undefined ? { tracePath } : {}),
      scratchpadDir: this.imagesDir,
      // The user's own words: a skill invocation or an origin note in front of them is the
      // host's framing, the same reading the goal start gives its objective.
      prompt: stripLeadingMarkerBlocks(text).trim() || text,
      ...(signal ? { signal } : {}),
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
   * A Prompt carrying text of the user's own is first put to the user-prompt hooks (see
   * hooks/prompt-hook.ts): each `context` they answer follows the Prompt as a user text
   * stamped `sender: "harness"` — yielded, since the host has not seen it, written to the
   * Trace and sent with the Prompt in the Task's first request.
   *
   * An empty `newMessages` is a retry of a failed run: the Task sends only what that run left
   * held (see `hasPendingInput`) — no input record of its own reaches the Trace, and with no
   * Prompt there is nothing to put to the user-prompt hooks.
   *
   * When the Task ends, the Session's stop hooks are consulted (see hooks/stop-hook.ts):
   * every answer is recorded as a `hook` event on the stream and in the Trace, and the first
   * `continue` drives another Task inside this same call — its input is yielded first, as a
   * user text message, since a plain run never yields its own input and hosts render the
   * injected one from the stream. No `continue`, a cutoff (abort, LLM failure, the
   * max_turns cap) or an aborted signal ends the call; the return value is the last Task's
   * cutoff, exactly as for a single Task.
   */
  async *run(
    newMessages: OmniMessage[],
    opts?: SessionRunOptions,
  ): AsyncGenerator<OmniMessage, RunCutoff | null> {
    // The sandbox command policy is applied here, at the Human boundary itself: the
    // injected callback is wrapped so a vetoed command is refused before the host is ever
    // asked, which is what makes the policy outrank every approval mode — no host, and no
    // approval mode, gets a say. Wrapped once for every Task of this call; a child Session
    // wraps its own forwarded callback again, harmlessly. With no callback at all the
    // engine denies everything anyway, so there is nothing to guard.
    if (opts?.approve) {
      opts = { ...opts, approve: withCommandPolicy(opts.approve, this.commandPolicy) };
    }
    // Pre-tool-use hooks ride the engine's consult seam (RunOptions.preToolUse): the
    // engine records their events in stream order and applies the first decision before
    // the approval callback. One rule is enforced here, where the command policy lives:
    // a hook `allow` never overrides the policy — hook packages sit in agent-writable
    // state, the policy is Project-owned security config — so a policy-vetoed allow is
    // downgraded to no decision and the approval chain (policy outermost) answers.
    // The hooks are read at each consult rather than captured here: a compaction inside
    // this call opens a context with hooks of its own, and the calls after it are theirs.
    {
      const signal = opts?.signal;
      opts = {
        ...opts,
        preToolUse: async (tc) => {
          const hooks = this.preToolUseHooks;
          if (hooks.length === 0) return null;
          const p = tc.payload;
          const tracePath = this.trace?.currentPath?.();
          const outcome = await runPreToolUseHooks(hooks, {
            sessionId: this.sessionId,
            ...(tracePath !== undefined ? { tracePath } : {}),
            toolName: p.name,
            toolCallId: p.tool_call_id,
            argumentsJson: p.arguments,
            ...(signal ? { signal } : {}),
          });
          if (
            outcome.decision === "allow" &&
            vetoForToolCall(p.name, p.arguments, this.commandPolicy?.()) !== null
          ) {
            return { ...outcome, decision: null };
          }
          return outcome;
        },
      };
    }
    const approve = opts?.approve;
    // User-prompt hooks ride the engine's consult seam too (RunOptions.userPrompt), for the
    // call's own Prompt only: a Task a stop hook continues into starts from the hook's
    // input, which no user submitted.
    let taskOpts: SessionRunOptions | undefined = {
      ...opts,
      userPrompt: (prompt, signal) => this.consultUserPromptHooks(prompt, signal),
    };
    let input = newMessages;
    for (;;) {
      // Manual iteration (not for-await) so the engine's return value — how the Task ended —
      // is read: a cutoff means the model never finished, which no `continue` may override.
      const it = this.runTask(input, taskOpts);
      taskOpts = opts;
      let cutoff: RunCutoff | null = null;
      for (;;) {
        const res = await it.next();
        if (res.done) {
          cutoff = res.value;
          break;
        }
        yield res.value;
      }
      if (this.stopHooks.length === 0) return cutoff;
      const tracePath = this.trace?.currentPath?.();
      const spawn = this.spawnSubagent;
      const outcome = await runStopHooks(
        this.stopHooks,
        {
          sessionId: this.sessionId,
          ...(tracePath !== undefined ? { tracePath } : {}),
          ...(opts?.signal ? { signal: opts.signal } : {}),
        },
        spawn ? (request) => spawn(request, approve) : undefined,
      );
      for (const ev of outcome.events) {
        await this.writeTrace(ev, "hook event");
        yield ev;
      }
      // A user's interruption outranks every hook: after a cutoff, or with the signal
      // already aborted between Tasks, a `continue` is recorded but never run — an aborted
      // engine would only hold the injected input as carry-over and leak it into the
      // user's next message.
      if (outcome.next === null || cutoff !== null || opts?.signal?.aborted) return cutoff;
      input = [userText(outcome.next, "harness")];
      yield input[0]!;
    }
  }

  /** The single-Task path: every Task of a `run` call — a hook-continued one included — runs one of these. */
  private async *runTask(
    newMessages: OmniMessage[],
    opts?: RunOptions,
  ): AsyncGenerator<OmniMessage, RunCutoff | null> {
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
      return { kind: "abort", errorCode: "user_abort" };
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
    // Manual iteration (not for-await) so the engine's return value — how the run ended —
    // propagates to this generator's own return.
    const it = this.engine!.run(newMessages, opts);
    let cutoff: RunCutoff | null = null;
    for (;;) {
      const res = await it.next();
      if (res.done) {
        cutoff = res.value;
        break;
      }
      const msg = res.value;
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
    return cutoff;
  }

  /**
   * First-run bootstrap: writes `session_meta`, opens the first context and builds the
   * engine — streaming the phase as it happens. The bootstrap publishes its records
   * through `emit` — with MCP Servers configured, the `mcp_connect_begin` /
   * `mcp_connect_end` pair around the connect + discovery wait (overall status +
   * per-server outcomes; the wall time is the pair's timestamp difference), then the
   * `tool_list_ready` carrying the resolved toolset (split out of session_meta precisely
   * so the meta never has to wait for this phase) — and a merge queue turns them into
   * live yields here while it runs: the same pump the engine's post-compaction opener
   * uses, because opening the first context and opening a later one are one procedure.
   *
   * The records are yielded live, but their Trace writes are DEFERRED to the engine
   * (ContextEngineDeps.bootstrapRecords / toolList): the engine writes them right after
   * this run's input, so the connect phase belongs to the new turn in the Trace — after
   * the user's message — instead of dangling before it (their earlier timestamps keep the
   * file chronological, since the input message was created before the connect began).
   *
   * Returns false when `signal` aborts mid-bootstrap: the attempt is CANCELLED
   * (`cancelBootstrap` → the provider aborts pending connects and resets — the next run
   * reconnects from scratch), a connect the abort cut short is closed with a
   * `status: "aborted"` end, and a standard abort event follows. The records are stashed
   * (abortedBootstrapRecords) for the caller, which writes the turn to the Trace itself —
   * input first, then the records — since no engine exists to do it; the input is also
   * carried (carryOverInput) so the next run delivers it to the model without re-writing
   * it. No-op returning true once the engine exists; a rejected bootstrap (unreadable
   * resume history, LLM construction) throws to the caller, and a later run retries with
   * a fresh attempt.
   */
  private async *ensureReady(signal?: AbortSignal): AsyncGenerator<OmniMessage, boolean> {
    await this.ensureMetaWritten();
    if (this.engine) return true;
    const records: OmniMessage[] = [];
    const { queue, result: work } = pumpOpener((emit) => this.bootstrap({ emit }));
    for (;;) {
      const res = await raceAbort(queue.next(), signal);
      if (res === "aborted") {
        this.cancelBootstrap?.();
        // The cancelled attempt settles on its own (rejection expected); anything it
        // publishes after this point is dropped, exactly as its return value is.
        work.catch(() => {});
        // Stashed (not written here) so the caller can put the run's INPUT first — the
        // Trace stays chronological: input, records, abort.
        this.abortedBootstrapRecords = [...records];
        // A connect the abort cut short never published its end: close the pair.
        const hasType = (t: string): boolean =>
          records.some((m) => (m.payload as { type?: string }).type === t);
        if (hasType("mcp_connect_begin") && !hasType("mcp_connect_end")) {
          const end = mcpConnectEnd({ status: "aborted", results: [] });
          yield end;
          this.abortedBootstrapRecords.push(end);
        }
        const aborted = abortEvent("user_abort");
        yield aborted;
        this.abortedBootstrapRecords.push(aborted);
        return false;
      }
      if (res.value === null) break;
      records.push(res.value);
      yield res.value;
    }
    const { llm } = await work;
    // The opener's toolset record rides as the engine's `toolList` (first-run write +
    // rotation rewrite); the connect pair — everything else — as bootstrapRecords.
    const toolsMsg = records.findLast(
      (m) => (m.payload as { type?: string }).type === "tool_list_ready",
    );
    const connectRecords = records.filter((m) => m !== toolsMsg);
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
    this.engine = new ContextEngine({
      ...this.engineDeps,
      ...(trace !== undefined ? { trace } : {}),
      llm,
      sessionMeta: this.meta,
      ...(toolsMsg !== undefined ? { toolList: toolsMsg } : {}),
      bootstrapRecords: connectRecords,
    });
    // A level assigned before the first run was buffered on the Session: hand it to the
    // engine now that it exists, ahead of the first turn request.
    if (this.level !== undefined) this.engine.setThinkingLevel(this.level);
    return true;
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

  /** The running context's model: its provider group (paired with `modelId` to form the model reference). The first context's at construction; a model switch moves it. */
  get provider(): string {
    return this.meta.payload.provider;
  }

  /** The running context's model: its upstream model_id (the request id sent to MMSP). */
  get modelId(): string {
    return this.meta.payload.model_id;
  }

  /**
   * Follows a context the composition layer opened (or re-assembled): `metaMessage`,
   * `provider` and `modelId` answer from its session_meta, the Prompt fold from its vision
   * answer, and its hooks replace the Session's. What it did not bring stays as it was.
   */
  private adoptContext(
    meta: OmniMessage | undefined,
    modelHasVision: boolean | undefined,
    hooks: SessionHooks | undefined,
  ): void {
    if (meta) this.meta = meta as SessionMetaMessage;
    if (modelHasVision !== undefined) this.modelHasVision = modelHasVision;
    if (hooks) this.adoptHooks(hooks);
  }

  /**
   * Switches the model this Session runs on, in place: the running context is closed on the
   * model it ran on, and the next one opens on the target. A context with completed turns is
   * closed by a compaction — always **summarize**, whatever the Agent's `compaction.mode`
   * says, because the summary is what the new model continues from. That compaction is an
   * ordinary `manual` one: an ordinary request on the old model, extending the prefix the
   * provider has cached. The model is recorded by the new context's `session_meta` alone; its
   * Trace file opens at once, headed by that record — what a resume reads the model from —
   * and the record is yielded last, so the stream names the model too. Only callable at a Task
   * boundary, like `compact()`. Not the `/model` handoff, which opens a NEW Session.
   *
   * Before any event: the model the Session is already on is a no-op, and a target that
   * cannot be switched to is refused with a {@link ModelSwitchRefusedError} naming why
   * (anything else thrown is a failure). A Session that never ran has no context to close:
   * its first context is re-assembled on the target, silently, and the first run opens it.
   * One resumed after a restart builds its engine first, as `compact()` does. How the context
   * is then closed and the next one opened is `ContextEngine.switchContext`; on which model,
   * the opener is told here.
   *
   * Returns the terminal status: `completed` — the Session is on the target, and children
   * spawned from here inherit it; anything else — the switch was stopped or its compaction
   * failed (the events say how) and the Session stays on the model it was on.
   */
  async *switchModel(opts: ModelSwitchOptions): AsyncGenerator<OmniMessage, StopReason> {
    const target: ModelRef = { provider: opts.provider, model_id: opts.modelId };
    if (sameModelRef(target, { provider: this.provider, model_id: this.modelId })) {
      return "completed";
    }
    if (!this.modelSwitch) {
      throw new ModelSwitchRefusedError(
        "model_unavailable",
        "Switching the model is not available for this Session.",
      );
    }
    await this.modelSwitch.validate(target);
    if (!this.engine && !this.metaWritten) {
      // Never ran: no context to close and nothing recorded — the first context is simply
      // assembled again, on the target, and the first run writes that context's meta.
      const { hooks, modelHasVision, ...first } =
        await this.modelSwitch.reassembleInitialContext(target);
      this.adoptContext(first.sessionMeta, modelHasVision, hooks);
      if (first.compaction) this.engineDeps.compaction = first.compaction;
      if (first.maxTurns !== undefined) this.engineDeps.maxTurns = first.maxTurns;
      return "completed";
    }
    if (this.compactability() === "unsupported") {
      throw new ModelSwitchRefusedError(
        "compaction_not_configured",
        "Context compaction is not configured for this Session, so its model cannot be switched.",
      );
    }
    if (!(yield* this.ensureEngine(opts.signal))) return "aborted";
    this.switchTarget = target;
    try {
      const status = yield* this.engine!.switchContext(opts.signal);
      // Input an aborted bootstrap left with the Session rides on like the engine's pending
      // input: its text alone, in memory (the original stays where the abort wrote it).
      if (status === "completed") {
        this.carryOverInput = this.carryOverInput.filter(
          (m) => (m.payload as { type?: string }).type === "text",
        );
      }
      return status;
    } finally {
      this.switchTarget = undefined;
    }
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
    // Nothing compactable and no engine: stay a strict no-op, without bootstrapping — a
    // session that never ran must not leave trace records (meta / tool_list_ready) behind,
    // or an untouched session would look resumable.
    if (!this.engine && this.compactability() !== "ok") return;
    if (!(yield* this.ensureEngine(opts?.signal))) return;
    yield* this.engine!.compact(opts);
  }

  /**
   * Builds the engine outside a run, for a compaction or a model switch. A Session resumed
   * after a restart is the case: its history is real and already on disk, and the engine
   * simply has not been built yet (that happens on the first run). The bootstrap injects the
   * replayed history into the LLM, so the compaction request folds the actual conversation —
   * rather than the call silently doing nothing and leaving the user waiting for a banner that
   * never arrives. A no-op returning true once the engine exists.
   *
   * Returns false when `signal` aborted the bootstrap: no engine exists to write the attempt's
   * records, so the Session writes them itself (as runTask does), keeping the interruption
   * visible in the Trace.
   */
  private async *ensureEngine(signal?: AbortSignal): AsyncGenerator<OmniMessage, boolean> {
    if (yield* this.ensureReady(signal)) return true;
    for (const m of this.abortedBootstrapRecords) {
      await this.writeTrace(m, "aborted bootstrap record");
    }
    this.abortedBootstrapRecords = [];
    return false;
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
      configured: Boolean(this.engineDeps.compaction && this.engineDeps.openNextContext),
      sessionTurns: init?.sessionTurns ?? 0,
      fromCompaction: init?.fromCompaction ?? false,
    });
  }

  /**
   * Whether a run with no input of its own would send anything — what a host's retry of a
   * failed run checks first, since `run([])` resends exactly what is held: the engine's
   * carry-over and pending compaction summary (see ContextEngine.hasPendingInput), and the
   * input an aborted bootstrap left with the Session. No engine yet: like `compactability`, a
   * Session resumed after a restart answers from what its Trace replay recovered — the state
   * the first run's engine starts from — or a failed turn would look already sent.
   */
  hasPendingInput(): boolean {
    if (this.carryOverInput.length > 0) return true;
    if (this.engine) return this.engine.hasPendingInput();
    const init = this.engineDeps.initialState;
    return (init?.carryOver?.length ?? 0) > 0 || init?.pendingSummary !== undefined;
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

  /**
   * The Session's thinking level — the SOFT-limited runtime parameter as plain state: an
   * assignment rides the very next LLM request (mid-context, even mid-Task), unlike the
   * prompt, toolset and model, which never change between a context's open and its close —
   * and nothing records it in the Trace. The live value is engine state
   * (`ContextEngine.setThinkingLevel`), buffered on the Session until the engine exists;
   * contexts keep their opening base (the creation option, else the Agent config) for
   * compaction requests and as the fallback while nothing was ever assigned. The cost of
   * the softness is the provider's cached context — changing the level invalidates the
   * cached messages — so a host lets the user know at the picker that compacting first is
   * recommended (the Web menu note, the CLI `/thinking` reply).
   * Callers: the Web App's in-chat picker (PATCH), the CLI's `--thinking` / `/thinking`.
   */
  get thinkingLevel(): ThinkingLevelName | undefined {
    return this.level;
  }
  set thinkingLevel(level: ThinkingLevelName) {
    this.level = level;
    this.engine?.setThinkingLevel(level);
  }

  /**
   * A tool's permission level (what the read-only approval mode auto-approves by);
   * undefined for unknown tools. Strict-tier: answers from the running context's toolset —
   * rebuilt at every rotation — so a permission edit applies when the next context opens.
   */
  toolPermission(name: string): ToolPermission | undefined {
    return this.environment.toolPermission(name);
  }

  /** The running context's session_meta message — the first context's until a compaction opens another (used e.g. by host tools to forward nested-session metadata to a parent session). */
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

  /**
   * Asks one of this Session's EXECUTING tool calls to continue as a background task, so the
   * turn can close (see EnvironmentInterface.detachToolCall). Not an abort: the call ends
   * `completed` with a registry handle and its work keeps running. An environment without the
   * method has no call to detach.
   */
  detachToolCall(toolCallId: string): ToolDetachResult {
    return this.environment.detachToolCall?.(toolCallId) ?? "not_running";
  }

  /** Whether a background subagent of this Session is mid-round (see EnvironmentInterface.hasRunningBackgroundSubagents). */
  hasRunningBackgroundSubagents(): boolean {
    return this.environment.hasRunningBackgroundSubagents?.() ?? false;
  }

  /** All live subagent child sessions of this Session's Environment, for a host UI's subagents panel (see EnvironmentInterface.listBackgroundSubagents). */
  listBackgroundSubagents(): BackgroundSubagentInfo[] {
    return this.environment.listBackgroundSubagents?.() ?? [];
  }

  /**
   * Host-initiated message to one child session by its Session id — the user's input on the
   * child, whatever its state: steering while it runs, a follow-up run while it is idle, a
   * revival when it is no longer live (see EnvironmentInterface.sendToBackgroundSubagent).
   * The human (panel) and the model (input_subagent) converge on the same channel.
   */
  async sendToBackgroundSubagent(
    childSessionId: string,
    messages: OmniMessage[],
    opts?: SubagentMessageOptions,
  ): Promise<SubagentMessageOutcome> {
    return (
      (await this.environment.sendToBackgroundSubagent?.(childSessionId, messages, opts)) ?? "gone"
    );
  }

  /** Host-initiated abort of one child session's current run — the session survives for follow-ups (see EnvironmentInterface.abortBackgroundSubagentRun). */
  abortBackgroundSubagentRun(childSessionId: string): boolean {
    return this.environment.abortBackgroundSubagentRun?.(childSessionId) ?? false;
  }

  /** Host-initiated pin of one live child session's thinking level — the child's own `thinkingLevel`, applied from its next LLM request (see EnvironmentInterface.setBackgroundSubagentThinkingLevel); false when the child is not live. */
  setBackgroundSubagentThinkingLevel(childSessionId: string, level: ThinkingLevelName): boolean {
    return this.environment.setBackgroundSubagentThinkingLevel?.(childSessionId, level) ?? false;
  }

  /** Attaches the host's session-lifetime fallback approval sink for child sessions (see EnvironmentInterface.setSubagentApprovalFallback). */
  setSubagentApprovalFallback(approve: ApproveFn): void {
    this.environment.setSubagentApprovalFallback?.(approve);
  }

  /** Attaches the single listener for subagent run-state changes; the host re-reads `listBackgroundSubagents` on each ping (see EnvironmentInterface.setSubagentStateListener). */
  onSubagentState(listener: () => void): void {
    this.environment.setSubagentStateListener?.(listener);
  }

  /** Attaches the single listener for background-task state changes; the host re-reads `listBackgroundCommands` / `listBackgroundSubagents` on each ping (see EnvironmentInterface.setBackgroundStateListener). */
  onBackgroundState(listener: () => void): void {
    this.environment.setBackgroundStateListener?.(listener);
  }

  /** Queues a background completion event; a running Task delivers it at the next boundary, otherwise the host is signaled (see pendingNotices). */
  private handleBackgroundDone(event: BackgroundTaskDoneEvent): void {
    this.pendingNotices.push(event);
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
   * a task's input — the notices become that task's starting input, so they carry no
   * `delivery` stamp and keep their independent turn in every render layer. Empties the
   * queue — the caller owns delivery of what it took; anything queued after this call is
   * signaled/drained separately.
   */
  takeBackgroundNotices(): OmniMessage[] {
    return this.pendingNotices.splice(0).map((e) => backgroundDoneNotice(e));
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
