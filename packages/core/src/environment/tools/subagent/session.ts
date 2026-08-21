/**
 * ManagedSubagentSession — a subagent session capable of running in the background.
 *
 * Holds a `SubagentHandle` and drives its `run` (pump): the same child Session may run across
 * multiple rounds (the first round is initiated by `run_subagent`, later rounds append a Prompt
 * via `input_subagent`). Structurally mirrors a command session (ManagedSession): the parent tool
 * call collects output live within the yield window; output produced outside the window (while
 * running in the background) goes into a buffer, delivered all at once on the next access.
 *
 * Three kinds of output, each with its own destination:
 * - **Message buffer**: all of the child session's OmniMessage (already tagged with origin), for
 *   the parent tool call to forward to the frontend for rendering; capped in count, overflow
 *   drops the oldest (only affects frontend replay — the child Session's own Trace loses no
 *   data);
 * - **Text buffer**: assistant text deltas from the direct child layer (origin one hop), fed back
 *   as the parent tool's own output to the LLM; capped in capacity (prevents memory bloat),
 *   overflow drops the oldest with a marker;
 * - **Approval queue**: the child session's tool approval requests. While running in the
 *   background, the parent session may have no active tool call to forward approval through, so
 *   the request is queued and the child session blocks waiting; the parent tool call
 *   (run_subagent / input_subagent) attaches an approval sink (`attachApprovalSink`) within its
 *   window to consult Human one request at a time — if detached mid-consultation (window ends),
 *   the request stays queued, and a late-arriving decision still takes effect (settled guard,
 *   first to arrive wins).
 *
 * Cleanup: `kill()` aborts the current run via AbortSignal, denies all pending approvals, and
 * releases child Session resources; idempotent. The child Session runs in-process, so there's no
 * need for a separate synchronous hard-kill path (its command sessions are reaped by their own
 * exit fallback); `killHard` is equivalent to `kill`.
 */
import type { OmniMessage } from "../../../omnimessage/index.js";
import type { ApprovalDecision, ToolCallPayload } from "../../../omnimessage/index.js";
import type { ApproveFn, SubagentHandle } from "../../../interfaces.js";
import type { ToolResult } from "../types.js";
import { CappedTextBuffer, WakeSignal } from "../background/index.js";

/** Message buffer count cap: overflow drops the oldest (only frontend replay is affected — the child Session has its own Trace). */
const MESSAGE_BUFFER_CAP = 4096;
/** Text buffer capacity cap (characters): prevents a chatty child Agent from blowing up memory. */
const OUTPUT_BUFFER_CAP = 1024 * 1024; // 1 MiB

/** Terminal state of one run. */
export interface SubagentExit {
  status: "completed" | "failed";
  note?: string;
}

/** A pending approval request: the settled guard makes the decision first-to-arrive-wins (late/duplicate decisions are ignored). */
interface PendingApproval {
  toolCall: OmniMessage<ToolCallPayload>;
  settled: boolean;
  resolve: (decision: ApprovalDecision) => void;
}

export class ManagedSubagentSession {
  /** Timestamp of the last access (used for the eviction policy). */
  lastUsed: number = Date.now();

  private readonly handle: SubagentHandle;
  private readonly abortCtrl = new AbortController();

  private messages: OmniMessage[] = [];
  private readonly textBuffer = new CappedTextBuffer(OUTPUT_BUFFER_CAP, "earlier subagent output");

  private isRunning = false;
  private exitInfo: SubagentExit | null = null;
  private killed = false;

  private readonly approvals: PendingApproval[] = [];
  private sink: { approve: ApproveFn; detached: Promise<void> } | null = null;
  private sinkEpoch = 0;
  private pumpingApprovals = false;

  // Single wake point: new message / run finished / new approval request all wake a waiting waitWake through it.
  private readonly wakeSignal = new WakeSignal();

  constructor(handle: SubagentHandle) {
    this.handle = handle;
  }

  /** Child Session id (one hop of a message's origin); `subagent_id` is derived from its tail so the frontend can correlate it. */
  get sessionId(): string {
    return this.handle.sessionId;
  }

  /** Whether a round of the task is currently running. */
  get running(): boolean {
    return this.isRunning;
  }

  /** Terminal state of the most recent run; null if no round has ever completed. */
  get exit(): SubagentExit | null {
    return this.exitInfo;
  }

  /** Number of pending approval requests (the parent tool uses this to hint the model to poll again). */
  get pendingApprovals(): number {
    return this.approvals.length;
  }

  /** Whether there's unread output (buffered messages or text); used to re-check the predicate before waiting (see collect.ts). */
  get hasPending(): boolean {
    return this.messages.length > 0 || !this.textBuffer.isEmpty;
  }

  /**
   * Starts a new round of the task on the child Session (async pump, doesn't block the caller).
   * Throws if already disposed or still running (converted to an explanatory output by the
   * caller).
   */
  startRun(prompt: string): void {
    if (this.killed) throw new Error("subagent session disposed");
    if (this.isRunning) throw new Error("subagent is still running");
    this.isRunning = true;
    this.exitInfo = null;
    void this.pump(prompt);
  }

  /** Takes the buffered child-session messages (already tagged with origin, for the parent tool to forward). */
  drainMessages(): OmniMessage[] {
    if (this.messages.length === 0) return [];
    const out = this.messages;
    this.messages = [];
    return out;
  }

  /** Takes the currently unread child Agent text (including the drop marker); clears the buffer. */
  drainText(): string {
    return this.textBuffer.drain();
  }

  /** External wakeup (e.g. the parent tool call was aborted): makes a waiting `waitWake` return immediately. */
  wakeup(): void {
    this.wakeSignal.notify();
  }

  /** Waits for "woken up" or `ms` to expire, whichever comes first. */
  async waitWake(ms: number): Promise<void> {
    await this.wakeSignal.wait(ms);
  }

  /**
   * Attaches an approval sink: the parent tool call active within the window hands in its own
   * `ctx.approve`, and queued approval requests are consulted with Human through it one at a
   * time. Returns a detach function (called when the window ends); a later attach replaces the
   * former one.
   */
  attachApprovalSink(approve: ApproveFn): () => void {
    const epoch = ++this.sinkEpoch;
    let onDetach!: () => void;
    const detached = new Promise<void>((resolve) => {
      onDetach = resolve;
    });
    this.sink = { approve, detached };
    void this.pumpApprovals();
    return () => {
      if (this.sinkEpoch === epoch) this.sink = null;
      onDetach();
    };
  }

  /** Cleanup: aborts the current run, denies pending approvals, releases child Session resources; idempotent. */
  kill(): void {
    if (this.killed) return;
    this.killed = true;
    this.abortCtrl.abort();
    for (const req of [...this.approvals]) this.settle(req, "deny");
    // If running, released by pump's finally after it finishes; otherwise released immediately.
    if (!this.isRunning) this.handle.dispose();
    this.wakeSignal.notify();
  }

  /** Synchronous hard-kill path: the child Session runs in-process with no separate OS resources, so this is equivalent to `kill`. */
  killHard(): void {
    this.kill();
  }

  // -------------------------------------------------------------------------
  // Internal: pump and buffering
  // -------------------------------------------------------------------------

  /** Drives one round of `handle.run`: buffers messages and text, settling the terminal state when it ends. */
  private async pump(prompt: string): Promise<void> {
    let wroteAny = false;
    let childAbort: string | null = null;
    try {
      for await (const msg of this.handle.run({
        prompt,
        signal: this.abortCtrl.signal,
        approve: this.childApprove,
      })) {
        this.bufferMessage(msg);
        if ((msg.origin?.length ?? 0) === 1) {
          const p = msg.payload as {
            type?: string;
            event_type?: string;
            text?: string;
            reason?: string;
          };
          // A direct child layer's abort event: the child session was interrupted/failed (LLM
          // request error, user interruption, etc). A child session failure doesn't throw, it
          // only emits an event, based on which this round is reported as failed rather than
          // marked completed.
          if (p.type === "abort") {
            childAbort = p.reason ?? "aborted";
          } else if (
            p.type === "partial_text" &&
            p.event_type === "delta" &&
            typeof p.text === "string" &&
            p.text
          ) {
            wroteAny = true;
            this.appendText(p.text);
          }
        }
        this.wakeSignal.notify();
      }
      if (childAbort !== null) {
        this.exitInfo = { status: "failed", note: `[subagent aborted: ${childAbort}]` };
      } else if (!wroteAny) {
        this.exitInfo = {
          status: "completed",
          note: "[subagent finished without a text answer]",
        };
      } else {
        this.exitInfo = { status: "completed" };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.exitInfo = { status: "failed", note: `[subagent error: ${message}]` };
    } finally {
      this.isRunning = false;
      if (this.killed) this.handle.dispose();
      this.wakeSignal.notify();
    }
  }

  private bufferMessage(msg: OmniMessage): void {
    this.messages.push(msg);
    // Overflow drops the oldest: only affects frontend replay — the child Session's Trace and text buffer are unaffected.
    if (this.messages.length > MESSAGE_BUFFER_CAP) this.messages.shift();
  }

  private appendText(text: string): void {
    this.textBuffer.append(text);
  }

  // -------------------------------------------------------------------------
  // Internal: approval queue
  // -------------------------------------------------------------------------

  /** Approval callback handed to the child Session: the request is queued and waits for some parent tool call to consult Human and give a decision. */
  private readonly childApprove: ApproveFn = (toolCall) => {
    if (this.killed) return Promise.resolve("deny");
    return new Promise<ApprovalDecision>((resolve) => {
      this.approvals.push({ toolCall, settled: false, resolve });
      this.wakeSignal.notify(); // Wake the parent tool call waiting within the window, so it can consult as soon as possible
      void this.pumpApprovals();
    });
  };

  /** Settles an approval decision: first to arrive wins, late/duplicate decisions are ignored. */
  private settle(req: PendingApproval, decision: ApprovalDecision): void {
    if (req.settled) return;
    req.settled = true;
    const idx = this.approvals.indexOf(req);
    if (idx >= 0) this.approvals.splice(idx, 1);
    req.resolve(decision);
    this.wakeSignal.notify();
  }

  /**
   * Hands the request at the head of the queue to the currently attached approval sink, one at a
   * time. Stops when the window ends (the sink is detached); unresolved requests stay queued for
   * the next sink; if a consultation already in flight resolves late, the decision still takes
   * effect via settle.
   */
  private async pumpApprovals(): Promise<void> {
    if (this.pumpingApprovals) return;
    this.pumpingApprovals = true;
    try {
      while (this.sink && this.approvals.length > 0) {
        const sink = this.sink;
        const req = this.approvals[0]!;
        const answer = sink.approve(req.toolCall).then(
          (d) => this.settle(req, d),
          () => this.settle(req, "deny"), // An approval sink error is treated as a denial (avoids leaving the child session stuck forever)
        );
        await Promise.race([answer, sink.detached]);
        if (req.settled) continue;
        if (this.sink && this.sink !== sink) continue; // The sink was replaced by a new call: retry with the new sink
        break; // The sink was detached and still unresolved: stay queued for the next sink
      }
    } finally {
      this.pumpingApprovals = false;
    }
  }
}

/** Converts a run's terminal state into a tool result (note is appended outside the truncation, so it isn't lost with long output). */
export function resultForSubagentExit(exit: SubagentExit | null): ToolResult {
  if (!exit) return { stopReason: "completed" };
  return { stopReason: exit.status, ...(exit.note !== undefined ? { note: exit.note } : {}) };
}
