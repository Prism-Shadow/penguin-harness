/**
 * CLI streaming renderer.
 *
 * Rendering rule: **only the streaming `partial_*` variants of model_msg are rendered**;
 * complete (non-streaming) model_msg is never rendered. A complete message's content has
 * already been delivered by its corresponding `partial_*` stream, so re-rendering it would
 * be redundant. `partial_*` is written out token by token as it arrives.
 * event_msg is not message rendering and is handled separately: `token_usage` accumulates
 * and is summarized in the `[stats]` line at task end, `approval_decision` prints one line
 * with the approval result, `abort` prints one line noting the interruption, and each of
 * `compaction_begin`/`compaction_end` prints one line of compaction progress;
 * `session_meta` is never rendered.
 *
 * **Screen lock (concurrent tools)**: tools run concurrently and asynchronously, so
 * messages may arrive interleaved. The renderer queues internally to guarantee:
 * - a streaming segment (the LLM's text/thinking/tool_call stream, or a given tool's
 *   output stream start->delta->stop) holds the screen until stop, while other messages
 *   queue up;
 * - all output is locked while waiting for user input (the approval prompt,
 *   `beginUserPrompt`/`endUserPrompt`);
 * - when the head of the queue is held, the holder's own subsequent messages are let
 *   through first (preserving in-segment order), avoiding deadlock.
 *
 * **Pairing tags**: a tool call and its output may be separated by several segments, so
 * both are tagged with a shared word for pairing: the call line reads
 * `[tool-653] $ cmd`, the output line `[tool-653] >> ...` (653 being the last 3
 * characters of tool_call_id); nested (subagent) tools use
 * `[agent-f2a-tool-653] $ cmd` (f2a being the last 3 characters of the direct child
 * Session id). Approval lines carry no tag (they immediately follow the matching call
 * line, so context makes the pairing clear): `[approved]`.
 *
 * **Nested sub-session messages** (those carrying an origin) are handled separately:
 * child tool calls (so the user can see what the subagent is calling before approval)
 * and child approval results are rendered, and child token_usage counts toward this
 * task's delta and the Session total; everything else (child text/thinking, etc.) is
 * not rendered — the child Agent's final text is already streamed through the parent
 * tool's output gutter.
 *
 * No third-party color library is used; only minimal ANSI escapes.
 */
import { isEventMessage, isModelMessage } from "@prismshadow/penguin-core";
import type {
  AbortPayload,
  ApprovalDecision,
  ApprovalDecisionPayload,
  CompactionBeginPayload,
  CompactionEndPayload,
  MessageOrigin,
  OmniMessage,
  PartialTextPayload,
  PartialThinkingPayload,
  PartialToolCallPayload,
  PartialToolCallOutputPayload,
  RequestEndPayload,
  TokenUsagePayload,
  ToolCallPayload,
} from "@prismshadow/penguin-core";
import { renderPartialToolCall } from "./tool-render.js";
import { defaultMessages } from "./i18n.js";
import type { Messages } from "./i18n.js";

const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

export function dim(text: string): string {
  return `${DIM}${text}${RESET}`;
}

/** Colors a tool call line cyan, distinguishing it from body text/thinking (review comment #5). */
function cyan(text: string): string {
  return `${CYAN}${text}${RESET}`;
}

/** Takes the last 3 characters of an id as the on-screen pairing number. */
function shortId(id: string): string {
  return id.slice(-3);
}

/**
 * On-screen pairing tag for a tool call/output: main-session tools ->
 * `tool-<last 3 chars of id>`; nested (subagent) tools ->
 * `agent-<last 3 chars of direct child Session>-tool-<last 3 chars of id>`.
 */
function callTag(toolCallId: string, origin?: readonly MessageOrigin[]): string {
  const tid = `tool-${shortId(toolCallId)}`;
  return origin && origin.length > 0 ? `agent-${shortId(origin[origin.length - 1]!)}-${tid}` : tid;
}

/** Converts a token count to a human-readable abbreviation: 1234->1.2k, 1500000->1.5M, <1000 unchanged. */
export function humanizeTokens(n: number): string {
  const abs = Math.abs(n);
  if (abs < 1000) return `${n}`;
  if (abs < 1_000_000) {
    const v = n / 1000;
    return `${trimZero(v)}k`;
  }
  const v = n / 1_000_000;
  return `${trimZero(v)}M`;
}

/** Keeps one decimal place but drops a trailing `.0`. */
function trimZero(v: number): string {
  const s = v.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

/** Adds an explicit sign to a delta string: non-negative gets a `+` prefix, negative already has its own `-` (context can go negative after compaction shrinks it). */
function signedDelta(formatted: string): string {
  return formatted.startsWith("-") ? formatted : `+${formatted}`;
}

/** Converts milliseconds into a human-readable duration: `820ms`, `2.3s`, `1m3s`. */
function humanizeDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${trimZero(s)}s`;
  const m = Math.floor(s / 60);
  return `${m}m${Math.round(s % 60)}s`;
}

export function formatAbort(p: AbortPayload, t: Messages): string {
  return dim(t.abortLabel(p.reason ?? undefined));
}

/**
 * Statically renders resumed history messages (`--resume`: full-message semantics, no
 * partial_*, including interrupted messages and their markers). Uses the
 * same color scheme as streaming rendering: user input `> `, dim thinking, cyan tool
 * calls, dim tool-output gutter; a message whose `stop_reason` isn't completed gets a
 * dim marker appended at the end of its line.
 */
export function renderHistory(
  messages: OmniMessage[],
  out: NodeJS.WritableStream,
  t: Messages = defaultMessages(),
): void {
  for (const msg of messages) {
    if (isEventMessage(msg)) {
      const p = msg.payload as { type?: string } & AbortPayload;
      if (p.type === "abort") out.write(`${formatAbort(p, t)}\n`);
      continue;
    }
    if (!isModelMessage(msg)) continue;
    const p = msg.payload as {
      type?: string;
      role?: string;
      text?: string;
      thinking?: string;
      name?: string;
      arguments?: string;
      output?: string;
      images?: string[];
      tool_call_id?: string;
      stop_reason?: string;
    };
    const marker = p.stop_reason && p.stop_reason !== "completed" ? dim(` [${p.stop_reason}]`) : "";
    switch (p.type) {
      case "text":
        if (p.role === "user") out.write(`\n> ${p.text ?? ""}\n`);
        else out.write(`${p.text ?? ""}${marker}\n`);
        break;
      case "image_url":
        out.write(`\n> ${dim("[image]")}\n`);
        break;
      case "thinking":
        out.write(`${dim(p.thinking ?? "")}${marker}\n`);
        break;
      case "tool_call": {
        const preview =
          renderPartialToolCall(p.name ?? "", p.arguments ?? "") ?? `${p.name} ${p.arguments}`;
        out.write(`${cyan(`[${callTag(p.tool_call_id ?? "")}] ${preview}`)}${marker}\n`);
        break;
      }
      case "tool_call_output": {
        const tag = callTag(p.tool_call_id ?? "");
        for (const line of (p.output ?? "").split("\n")) {
          out.write(`${DIM}[${tag}] >> ${RESET}${line}\n`);
        }
        // Attached images aren't rendered by the terminal; print one placeholder line per image.
        for (const _ of p.images ?? []) {
          out.write(`${DIM}[${tag}] >> [image]${RESET}\n`);
        }
        break;
      }
      default:
        break; // inline_data / inline_thinking etc.: not shown in static history rendering for now
    }
  }
}

/**
 * Streaming renderer: writes the OmniMessage stream to the output stream. The display
 * text for tool calls is decided locally by `tool-render.ts`; it no longer accepts a
 * tool-render callback from core (rendering has moved down into the CLI).
 */
export class StreamRenderer {
  private readonly out: NodeJS.WritableStream;
  private readonly t: Messages;

  /** Pending render queue: while the screen is held (a streaming segment is in progress / awaiting user input), messages queue up here. */
  private pending: OmniMessage[] = [];
  /** The streaming segment currently holding the screen ("llm" or "out:<tool_call_id>"); null = idle. */
  private holder: string | null = null;
  /** Awaiting user input (approval prompt): locks the screen, all messages queue up. */
  private promptActive = false;
  /** Key of the call the current interactive prompt belongs to (the tool_call passed to beginUserPrompt); null = unattached. */
  private promptKey: string | null = null;
  /**
   * Approval results for **other calls** that arrive during an interactive prompt
   * (concurrent subagent / auto-approval paths): must not be written straight into the
   * middle of an unanswered prompt, so they're deferred and rendered in order once
   * endUserPrompt unlocks the screen.
   */
  private deferredDecisions: Array<{
    toolCall: OmniMessage<ToolCallPayload>;
    decision: ApprovalDecision;
  }> = [];
  /** Reentrancy guard for drain. */
  private draining = false;
  /**
   * Keys (origin chain + tool_call_id) of call lines already **rendered in place** from
   * a complete message: rendered ahead of the streaming copy at approval time, so any
   * streaming/nested copy that arrives afterward is deduplicated and skipped based on
   * this set. Guarantees the approval prompt always immediately follows its matching
   * call line (messages arrive through an async pipeline and may arrive later than the
   * approval callback). Cleared at task end (see endTask).
   */
  private ensuredCallLines = new Set<string>();
  /** Call-line key of the last **content line actually written**; cleared once anything else is written. Used to check whether a call line is still adjacent to the current position. */
  private lastLineKey: string | null = null;
  /** Calls whose result has already been rendered in place at the approval callback (keyed the same as callLineKey); deduplicates a later-arriving approval_decision event. */
  private renderedDecisions = new Set<string>();

  /** Whether we're currently mid-way through a streaming line (text/thinking/tool output) that hasn't been newline-terminated yet. */
  private inLine = false;
  /** Whether we're currently in a dim span (thinking), used to know when to emit RESET. */
  private inDim = false;
  /** Whether tool-call output is at the start of a line (decides whether the gutter needs to be written). */
  private toolOutLineStart = true;
  /** Buffer for partial_tool_call; each delta streams out the newly appended suffix of the preview. */
  private partialToolCalls = new Map<
    string,
    { name: string; arguments: string; lastPreview: string }
  >();
  /** The partial_tool_call currently being rendered as a stream. */
  private partialToolCallLineId: string | null = null;
  /** This task's accumulated request tokens, the parent session's cumulative Session tokens, and whether this task has seen any usage. */
  private taskTokens = 0;
  private sessionTotal = 0;
  private hasUsage = false;
  /**
   * Session-level accumulation of sub-session (subagent) request tokens: persists across
   * tasks, never reset by endTask. The Token total shown to the user =
   * sessionTotal + subagentTotal, using the same accounting as this task's delta
   * (parent + child), guaranteeing the sum of per-task deltas never exceeds the
   * cumulative increase.
   */
  private subagentTotal = 0;
  /** Current context (= input+output = total of the most recent request), the context at the end of the previous task, and cumulative Session elapsed time (ms). */
  private contextNow = 0;
  private contextAtTaskStart = 0;
  private sessionElapsedMs = 0;
  /**
   * Compaction in progress (between a pair of parent-session compaction events): any
   * parent-session token_usage arriving during this window is compaction-request usage —
   * it does not update the context accounting (the actual usage after compaction is
   * reported by the next normal request); it's accumulated into compactionTokens so the
   * compaction-completion line can show "usage this time", and also staged into
   * pendingCompactionTokens pending final attribution (see below).
   */
  private compactionActive = false;
  private compactionTokens = 0;
  /**
   * Staged compaction usage: when a compaction event arrives, it's not yet known whether
   * it happened **mid-turn** (a normal request_end still follows in this turn ->
   * attribute to this turn) or **after the turn ended** (nothing follows -> don't
   * attribute to this turn). Mid-turn compaction is folded into taskTokens at the next
   * non-compaction request_end; compaction after the turn ended is discarded when
   * endTask/endCompact settles up. Uses the same accounting as the Web side
   * (stream-model / task-stats).
   */
  private pendingCompactionTokens = 0;
  /**
   * Timestamps (ms) of this task's first (non-session_meta) message and its last
   * **non-compaction** request_end: the elapsed time shown in the stats line = the
   * latter minus the former. A mid-turn compaction naturally falls within this span and
   * is counted; one after the turn ends falls after it and is naturally excluded
   * (consistent with "the last request_end before stats were queried"). The degenerate
   * case of a turn with no request_end at all falls back to the externally supplied
   * wall-clock elapsed time.
   */
  private taskFirstTsMs: number | null = null;
  private taskLastReqEndMs: number | null = null;
  /** Terminal state (timeout/malformed) of the previous request: the next request_begin is a retry, at which point a notice is printed. */
  private pendingRetry: "timeout" | "malformed" | null = null;
  /** Number of retries already initiated (increments on consecutive failures, reset once a request completes normally). */
  private reconnectRun = 0;

  constructor(out: NodeJS.WritableStream = process.stdout, t: Messages = defaultMessages()) {
    this.out = out;
    this.t = t;
  }

  handle(msg: OmniMessage): void {
    this.pending.push(msg);
    this.drain();
  }

  /**
   * Enters user interaction (approval prompt): first ensures the call line awaiting
   * approval is **immediately adjacent to the current position** (if unrendered or
   * separated by other output, render it in place from the complete message directly),
   * then finishes the current line and locks the screen, queuing any messages that
   * arrive in the meantime — guaranteeing "tool call -> approval prompt" stay adjacent,
   * for both the main Agent and subagents.
   */
  beginUserPrompt(toolCall?: OmniMessage<ToolCallPayload>): void {
    if (toolCall) this.ensureAdjacentCallLine(toolCall);
    this.finishLine();
    this.promptActive = true;
    this.promptKey = toolCall
      ? this.callLineKey(toolCall.payload.tool_call_id, toolCall.origin)
      : null;
  }

  /**
   * Renders one approval result, guaranteeing "tool call -> (approval prompt) ->
   * approval result" appear consecutively:
   * - interactive path: called **before** the prompt ends and unlocks (nothing else can
   *   preempt output while the lock is held);
   * - auto-approval path (allow-all etc., no prompt): if the call line isn't adjacent,
   *   render it in place first, then write the result, so they appear as a pair.
   * Idempotent (a given call's result is rendered only once); a subsequent
   * approval_decision event arriving through the pipeline is deduplicated by key.
   */
  noteApprovalDecision(toolCall: OmniMessage<ToolCallPayload>, decision: ApprovalDecision): void {
    const key = this.callLineKey(toolCall.payload.tool_call_id, toolCall.origin);
    // The screen is locked by **another call's** interactive prompt (e.g. auto-approval
    // of a concurrent subagent): must not write straight into the middle of an
    // unanswered prompt, so defer until unlocked; this prompt's own result still renders
    // in place as usual (it holds the lock).
    if (this.promptActive && this.promptKey !== key) {
      this.deferredDecisions.push({ toolCall, decision });
      return;
    }
    if (this.renderedDecisions.has(key)) return;
    this.renderedDecisions.add(key);
    this.ensureAdjacentCallLine(toolCall);
    this.finishLine();
    this.out.write(`${dim(this.t.approvalDecision(decision))}\n`);
    this.lastLineKey = null;
  }

  /** Call-line dedup key: origin chain + tool_call_id (parent/child session ids may collide, so the chain is needed to disambiguate). */
  private callLineKey(id: string, origin?: readonly MessageOrigin[]): string {
    return `${origin?.join("/") ?? ""}:${id}`;
  }

  /**
   * Ensures a given tool_call's call line is adjacent to the current position: if it
   * isn't the last content line (unrendered, or separated by other output since), it is
   * (re-)rendered in place from the complete message, and registered so any late
   * streaming/nested copy is deduplicated and skipped.
   */
  private ensureAdjacentCallLine(tc: OmniMessage<ToolCallPayload>): void {
    const key = this.callLineKey(tc.payload.tool_call_id, tc.origin);
    // The call line is already the last content line and its streaming segment has
    // already finished: already adjacent, nothing to do. If it's still mid-stream (the
    // line may show only half the arguments), re-render the full line in place and
    // register it for dedup — otherwise a late tail delta arriving after unlock would
    // start a duplicate call line, breaking the "call -> prompt -> result" adjacency
    // invariant.
    if (this.lastLineKey === key && this.partialToolCallLineId !== tc.payload.tool_call_id) {
      return;
    }
    this.renderCallLine(tc.payload, tc.origin, key);
  }

  /** Renders one call line in place from a complete tool_call and registers its dedup key (shared by in-place approval rendering and nested rendering). */
  private renderCallLine(
    p: ToolCallPayload,
    origin: readonly MessageOrigin[] | undefined,
    key: string,
  ): void {
    this.ensuredCallLines.add(key);
    const preview = renderPartialToolCall(p.name, p.arguments) ?? `${p.name} ${p.arguments}`;
    this.finishLine();
    this.out.write(`${cyan(`[${callTag(p.tool_call_id, origin)}] ${preview}`)}\n`);
    this.lastLineKey = key;
  }

  /** User interaction ends: unlocks the screen, first renders approval results deferred during the lock, then drains the queue. */
  endUserPrompt(): void {
    this.promptActive = false;
    this.promptKey = null;
    this.flushDeferredDecisions();
    this.drain();
  }

  /** Renders approval results deferred during the interactive prompt (call line + result as a pair; called after unlocking). */
  private flushDeferredDecisions(): void {
    const deferred = this.deferredDecisions;
    if (deferred.length === 0) return;
    this.deferredDecisions = [];
    for (const d of deferred) this.noteApprovalDecision(d.toolCall, d.decision);
  }

  /** Streaming segment ownership: the LLM stream (text/thinking/tool_call share one stream serially) or a given tool's output stream; null = atomic message. */
  private streamOwner(msg: OmniMessage): string | null {
    if (msg.origin && msg.origin.length > 0) return null; // nested messages render as atomic lines
    if (!isModelMessage(msg)) return null;
    const type = msg.payload.type;
    if (type === "partial_text" || type === "partial_thinking" || type === "partial_tool_call") {
      return "llm";
    }
    if (type === "partial_tool_call_output") {
      return `out:${(msg.payload as PartialToolCallOutputPayload).tool_call_id}`;
    }
    return null;
  }

  private isStop(msg: OmniMessage): boolean {
    return (msg.payload as { event_type?: string }).event_type === "stop";
  }

  /**
   * Drains the pending render queue. The same streaming segment (start->delta->stop)
   * holds the screen until stop, while other messages queue up; while the screen is
   * held, the holder's own subsequent messages are let through first (preserving
   * in-segment order, while other messages keep their arrival order); nothing is let
   * through while awaiting user input.
   */
  private drain(): void {
    if (this.draining) return;
    this.draining = true;
    try {
      while (!this.promptActive && this.pending.length > 0) {
        if (this.holder === null) {
          const msg = this.pending.shift()!;
          const owner = this.streamOwner(msg);
          if (owner !== null) this.holder = this.isStop(msg) ? null : owner;
          this.renderNow(msg);
          continue;
        }
        // Screen is held: let through all of the holder's own messages in a single
        // pass (avoiding the quadratic cost of rescanning from the queue head after
        // each message); once the holder releases mid-scan (stop), put the remaining
        // messages back in original order, returning to plain FIFO.
        const keep: OmniMessage[] = [];
        let progressed = false;
        for (let i = 0; i < this.pending.length; i++) {
          if (this.promptActive || this.holder === null) {
            keep.push(...this.pending.slice(i));
            break;
          }
          const msg = this.pending[i]!;
          if (this.streamOwner(msg) === this.holder) {
            if (this.isStop(msg)) this.holder = null;
            this.renderNow(msg);
            progressed = true;
          } else {
            keep.push(msg);
          }
        }
        this.pending = keep;
        if (!progressed) break; // no message from the holder in the queue: wait for it to arrive
      }
    } finally {
      this.draining = false;
    }
  }

  /** Actually renders one message (queue scheduling is already done by drain). */
  private renderNow(msg: OmniMessage): void {
    if (msg.origin && msg.origin.length > 0) {
      this.handleNested(msg);
      return;
    }
    // The timestamp of this task's first (non-session_meta) message = the start point for
    // the stats-line elapsed time. session_meta can predate this turn by a long time (a
    // session may sit idle for a day before the first question), so it is excluded,
    // matching Web / Trace accounting.
    if (this.taskFirstTsMs === null && msg.type !== "session_meta") {
      const ms = Date.parse(msg.timestamp);
      if (Number.isFinite(ms)) this.taskFirstTsMs = ms;
    }
    if (isModelMessage(msg)) {
      const payload = msg.payload;
      switch (payload.type) {
        case "partial_text":
          this.handlePartialText(payload as PartialTextPayload);
          return;
        case "partial_thinking":
          this.handlePartialThinking(payload as PartialThinkingPayload);
          return;
        case "partial_tool_call":
          this.handlePartialToolCall(payload as PartialToolCallPayload);
          return;
        case "partial_tool_call_output":
          this.handlePartialToolOutput(payload as PartialToolCallOutputPayload);
          return;
        // Complete (non-streaming) model_msg is never rendered (including image_url/inline_*); the content has already been shown by partial_*.
        default:
          return;
      }
    }

    if (isEventMessage(msg)) {
      const payload = msg.payload;
      if (payload.type === "token_usage") {
        // Accumulate this task's usage, printed together when the task ends (endTask),
        // not shown after every tool call/round.
        const p = payload as TokenUsagePayload;
        this.sessionTotal = p.session.total;
        if (this.compactionActive) {
          // Usage of a compaction request: staged first (final attribution depends on
          // whether a normal request_end still follows in this turn), and accumulated
          // into compactionTokens so the compaction-completion line can show "usage this
          // time"; does not update context accounting (see the compactionActive comment).
          this.pendingCompactionTokens += p.request.total;
          this.compactionTokens += p.request.total;
        } else {
          this.taskTokens += p.request.total;
          this.contextNow = p.request.total; // current context = total of the most recent normal request
          this.hasUsage = true;
        }
      } else if (payload.type === "approval_decision") {
        // The approval result has usually already been rendered in place at the
        // approval callback (noteApprovalDecision, guaranteeing three consecutive
        // lines); deduplicated here by key; falls back to rendering one line (without a
        // pairing tag) if it wasn't rendered yet.
        const p = payload as ApprovalDecisionPayload;
        if (this.renderedDecisions.delete(this.callLineKey(p.tool_call_id))) return;
        this.finishLine();
        this.out.write(`${dim(this.t.approvalDecision(p.decision))}\n`);
        this.lastLineKey = null;
      } else if (payload.type === "abort") {
        // Run ended (user interrupt / retries exhausted): clear any pending retry state so the next run doesn't mistakenly print a retry line.
        this.pendingRetry = null;
        this.reconnectRun = 0;
        this.finishLine();
        this.out.write(`${formatAbort(payload as AbortPayload, this.t)}\n`);
        this.lastLineKey = null;
      } else if (payload.type === "request_begin") {
        // The previous request ended in timeout/malformed -> this request is a retry
        // carrying <turn_retried>: printed when the retry **actually starts** (when
        // retries are exhausted, there's no retry after the last failure, only an abort
        // explaining why).
        if (this.pendingRetry) {
          this.reconnectRun += 1;
          this.finishLine();
          this.out.write(`${dim(this.t.reconnectLabel(this.pendingRetry, this.reconnectRun))}\n`);
          this.lastLineKey = null;
          this.pendingRetry = null;
        }
      } else if (payload.type === "request_end") {
        const p = payload as RequestEndPayload;
        if (!this.compactionActive) {
          // A non-compaction request_end = the end of the turn so far: records the
          // timestamp (the end point for elapsed time), and settles any previously
          // staged compaction usage — reaching here means that compaction was followed
          // by a normal Request in this turn (mid-turn compaction), so its usage is
          // attributed to this turn.
          const ms = Date.parse(msg.timestamp);
          if (Number.isFinite(ms)) this.taskLastReqEndMs = ms;
          if (this.pendingCompactionTokens > 0) {
            this.taskTokens += this.pendingCompactionTokens;
            this.pendingCompactionTokens = 0;
            this.hasUsage = true;
          }
        }
        if (p.status === "timeout" || p.status === "malformed") {
          this.pendingRetry = p.status;
        } else {
          this.pendingRetry = null;
          this.reconnectRun = 0;
        }
      } else if (payload.type === "compaction_begin") {
        // Paired compaction events: begin signals compaction is in progress.
        const p = payload as CompactionBeginPayload;
        this.finishLine();
        this.compactionActive = true;
        this.compactionTokens = 0;
        this.out.write(`${dim(this.t.compactionStart(p.mode, p.reason))}\n`);
        this.lastLineKey = null;
      } else if (payload.type === "compaction_end") {
        // end signals the result and shows the tokens consumed by the compaction request (if any).
        const p = payload as CompactionEndPayload;
        this.finishLine();
        this.compactionActive = false;
        // Same accounting as the stats line: total = Session cumulative (parent + child), delta = usage of this compaction.
        const tokens =
          this.compactionTokens > 0
            ? {
                total: humanizeTokens(this.sessionTotal + this.subagentTotal),
                delta: signedDelta(humanizeTokens(this.compactionTokens)),
              }
            : undefined;
        this.compactionTokens = 0;
        this.out.write(`${dim(this.t.compactionStop(p.mode, p.status, tokens))}\n`);
        this.lastLineKey = null;
      }
      return;
    }
    // session_meta: not rendered.
  }

  /**
   * Nested sub-session messages (carrying an origin): renders the child tool call
   * (tagged `agent-xxx-tool-xxx` to mark it as coming from a subagent) and its approval
   * result; the request delta of a child token_usage counts toward this task's usage;
   * everything else is not rendered (see the rendering rule at the top of this file).
   */
  private handleNested(msg: OmniMessage): void {
    const origin = msg.origin!;
    if (isModelMessage(msg)) {
      if (msg.payload.type === "tool_call") {
        // A complete tool_call renders one line (nested messages never render
        // partial_*, so there's no duplication); one already rendered in place at
        // approval time (message arrived later than the approval callback) is
        // deduplicated by key and skipped.
        const p = msg.payload as ToolCallPayload;
        const key = this.callLineKey(p.tool_call_id, origin);
        if (this.ensuredCallLines.has(key)) return;
        this.renderCallLine(p, origin, key);
      }
      return;
    }
    if (isEventMessage(msg)) {
      if (msg.payload.type === "approval_decision") {
        // The approval result is usually already rendered in place at the approval callback; deduplicated here by key; falls back to rendering if it wasn't rendered yet.
        const p = msg.payload as ApprovalDecisionPayload;
        if (this.renderedDecisions.delete(this.callLineKey(p.tool_call_id, origin))) {
          return;
        }
        this.finishLine();
        this.out.write(`${dim(this.t.approvalDecision(p.decision))}\n`);
        this.lastLineKey = null;
      } else if (msg.payload.type === "token_usage") {
        // Child-session usage counts toward this task's Token delta and the Session total (parent and child use the same accounting); context still follows parent-session accounting.
        const req = (msg.payload as TokenUsagePayload).request.total;
        this.taskTokens += req;
        this.subagentTotal += req;
        this.hasUsage = true;
      }
    }
  }

  private handlePartialText(p: PartialTextPayload): void {
    if (p.event_type === "stop") {
      this.finishLine();
      return;
    }
    // Insert a line break when switching from thinking (dim) to body text, to avoid them running together.
    if (this.inDim) this.finishLine();
    if (p.text) {
      this.out.write(p.text);
      this.inLine = true;
      this.lastLineKey = null;
    }
  }

  private handlePartialThinking(p: PartialThinkingPayload): void {
    if (p.event_type === "stop") {
      this.finishLine();
      return;
    }
    if (!this.inDim) {
      this.out.write(DIM);
      this.inDim = true;
    }
    if (p.thinking) {
      this.out.write(p.thinking);
      this.inLine = true;
      this.lastLineKey = null;
    }
  }

  private handlePartialToolCall(p: PartialToolCallPayload): void {
    // The call line was already rendered in place from the complete message at approval time: skip the whole late-arriving streaming copy (clean up the buffer on stop).
    if (this.ensuredCallLines.has(this.callLineKey(p.tool_call_id))) {
      if (p.event_type === "stop") this.partialToolCalls.delete(p.tool_call_id);
      return;
    }
    let partial = this.partialToolCalls.get(p.tool_call_id);
    if (!partial) {
      if (p.event_type === "stop") return;
      partial = { name: p.name, arguments: "", lastPreview: "" };
      this.partialToolCalls.set(p.tool_call_id, partial);
    }
    if (p.name) partial.name = p.name;
    if (p.arguments) {
      partial.arguments += p.arguments;
    }

    if (p.event_type === "stop") {
      if (partial.lastPreview) this.finishLine();
      this.partialToolCalls.delete(p.tool_call_id);
      return;
    }

    if (!p.arguments) return;

    if (this.inDim) this.finishLine();
    const preview = renderPartialToolCall(partial.name, partial.arguments);
    if (preview === null) return;

    // The line starts with a pairing tag [tool-<last 3 chars of id>], matching the output line that follows.
    const key = this.callLineKey(p.tool_call_id);
    if (this.partialToolCallLineId !== p.tool_call_id) {
      this.finishLine();
      this.partialToolCallLineId = p.tool_call_id;
      this.out.write(cyan(`[${callTag(p.tool_call_id)}] ${preview}`));
    } else if (preview.startsWith(partial.lastPreview)) {
      this.out.write(cyan(preview.slice(partial.lastPreview.length)));
    } else {
      // The preview usually grows monotonically with the arguments; if escaping/folding makes it non-appendable, start a new line with the current readable state.
      this.finishLine();
      this.partialToolCallLineId = p.tool_call_id;
      this.out.write(cyan(`[${callTag(p.tool_call_id)}] ${preview}`));
    }
    partial.lastPreview = preview;
    this.inLine = true;
    this.lastLineKey = key;
  }

  private handlePartialToolOutput(p: PartialToolCallOutputPayload): void {
    if (p.event_type === "stop") {
      this.finishLine();
      return;
    }
    if (this.inDim) this.finishLine();
    if (p.output) this.writeToolOutput(p.output, callTag(p.tool_call_id));
    // Image delta (carried whole in a single delta): the terminal doesn't render the
    // image itself, so print one placeholder line per image, using the same pairing tag
    // as the output gutter.
    if (p.images && p.images.length > 0) {
      this.finishLine();
      const tag = callTag(p.tool_call_id);
      for (const _ of p.images) {
        this.out.write(`${DIM}[${tag}] >> [image]${RESET}\n`);
      }
      this.lastLineKey = null;
    }
  }

  /**
   * Writes tool-call **output** line by line, each line starting with the dim gutter
   * `[tool-<last 3 chars of id>] >> `, paired with the call line (cyan `[tool-xxx] $
   * cmd`). Streaming chunks arrive incrementally; whether to write the gutter is
   * decided by the current line-start state.
   */
  private writeToolOutput(chunk: string, tag: string): void {
    let i = 0;
    while (i < chunk.length) {
      if (this.toolOutLineStart) {
        this.out.write(`${DIM}[${tag}] >> ${RESET}`);
        this.toolOutLineStart = false;
        this.inLine = true;
      }
      const nl = chunk.indexOf("\n", i);
      if (nl === -1) {
        this.out.write(chunk.slice(i));
        i = chunk.length;
      } else {
        this.out.write(chunk.slice(i, nl + 1));
        this.toolOutLineStart = true;
        this.inLine = false;
        i = nl + 1;
      }
    }
    this.lastLineKey = null;
  }

  /**
   * Task end: forcibly releases the screen lock and drains any remaining messages
   * (normally every streaming segment has already closed), finishes the current line,
   * and prints one line of stats — all as Session cumulative values + this task's
   * delta: context (input+output of the most recent request; delta = minus the context
   * at the start of this task, which can be negative once compaction shrinks context),
   * Token (Session cumulative = parent-session cumulative + child-session cumulative;
   * delta = added this task, same accounting for parent and child), elapsed time
   * (Session total elapsed; delta = this task's elapsed). This task's counters are then
   * reset.
   */
  endTask(elapsedMs = 0): void {
    this.promptActive = false;
    this.promptKey = null;
    this.flushDeferredDecisions();
    this.holder = null;
    this.drain();
    this.finishLine();
    // This task's elapsed time = first message -> last non-compaction request_end
    // (mid-turn compaction falls within the span and is counted; compaction after the
    // turn ends falls after it and isn't). The degenerate case of a turn with no
    // request_end at all (e.g. aborted before the first Request even ran) falls back to
    // the externally supplied wall-clock elapsedMs. Any staged but unsettled compaction
    // usage is discarded here (compaction after the turn ended isn't attributed to it).
    const elapsed =
      this.taskFirstTsMs !== null && this.taskLastReqEndMs !== null
        ? Math.max(0, this.taskLastReqEndMs - this.taskFirstTsMs)
        : elapsedMs;
    this.sessionElapsedMs += elapsed;
    if (this.hasUsage) {
      const contextDelta = this.contextNow - this.contextAtTaskStart;
      this.out.write(
        `${dim(
          this.t.taskStats({
            context: humanizeTokens(this.contextNow),
            contextDelta: signedDelta(humanizeTokens(contextDelta)),
            tokens: humanizeTokens(this.sessionTotal + this.subagentTotal),
            tokensDelta: signedDelta(humanizeTokens(this.taskTokens)),
            elapsed: humanizeDuration(this.sessionElapsedMs),
            elapsedDelta: signedDelta(humanizeDuration(elapsed)),
          }),
        )}\n`,
      );
      this.contextAtTaskStart = this.contextNow;
      this.lastLineKey = null;
    }
    this.taskTokens = 0;
    this.pendingCompactionTokens = 0;
    this.taskFirstTsMs = null;
    this.taskLastReqEndMs = null;
    this.hasUsage = false;
    // Compaction always closes within run/compact (stop is always reached); this is a
    // defensive reset to prevent state from leaking into the next task on an
    // exceptional path.
    this.compactionActive = false;
    this.compactionTokens = 0;
    // Dedup/buffer registrations are only meaningful within this task: clear them to prevent unbounded growth in long sessions (chat).
    this.ensuredCallLines.clear();
    this.renderedDecisions.clear();
    this.partialToolCalls.clear();
  }

  /**
   * Cleans up after a manual `/compact` (outside a Task boundary): compaction usage has
   * already been shown on the compaction-completion line and counted into the Session
   * total, so no stats line is printed here; only settles the Session elapsed time and
   * resets this task's counters — otherwise the compaction's usage would remain in
   * taskTokens and be mistakenly counted into the next task's `[stats]` delta (or never
   * settled at all if the user exits right after).
   */
  endCompact(elapsedMs = 0): void {
    this.sessionElapsedMs += elapsedMs;
    this.taskTokens = 0;
    this.pendingCompactionTokens = 0;
    this.taskFirstTsMs = null;
    this.taskLastReqEndMs = null;
    this.hasUsage = false;
    this.compactionActive = false;
    this.compactionTokens = 0;
  }

  private closeDim(): void {
    if (this.inDim) {
      this.out.write(RESET);
      this.inDim = false;
    }
  }

  /** Finishes the current streaming line: closes dim mode, emits a trailing newline, and resets tool output to line-start. */
  private finishLine(): void {
    this.closeDim();
    if (this.inLine) {
      this.out.write("\n");
      this.inLine = false;
    }
    this.toolOutLineStart = true;
    this.partialToolCallLineId = null;
  }
}
