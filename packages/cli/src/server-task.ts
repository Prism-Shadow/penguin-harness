/**
 * Server-backed task machinery shared by `run`, `chat`, `input` and `logs -f`.
 *
 * A task is driven entirely by the server; the CLI subscribes to the Session's SSE
 * stream FIRST (so nothing is missed), POSTs the task, then consumes frames until the
 * `task_state` flip back to idle:
 *   - default-event frames are OmniMessages, fed straight into StreamRenderer.handle —
 *     the same protocol core streams, so rendering is unchanged;
 *   - `server_event` frames carry `task_state` (end detection; the first event on a
 *     fresh subscription is an authoritative snapshot), `approval_request` (the [Y/n]
 *     prompt → POST /approvals/:toolCallId) and the goal progress events.
 *
 * Reconnects ride Last-Event-ID: the stream keeps the last seen frame id and reopens
 * with it on a dropped connection; `resync_required` (buffer evicted) prints a dim
 * notice — the messages endpoint still holds the full history for `penguin logs`.
 */
import {
  isEventMessage,
  isHarnessInput,
  isModelMessage,
  parseBackgroundTaskDoneMessage,
} from "@prismshadow/penguin-core";
import type { ApprovalDecision, OmniMessage, ToolCallPayload } from "@prismshadow/penguin-core";
import { ServerClient } from "./client.js";
import type { SseFrame } from "./client.js";
import { dim, humanizeTokens } from "./render.js";
import type { StreamRenderer } from "./render.js";
import type { Messages } from "./i18n.js";

/** Server events the watcher understands (structural subset of the server's ServerEvent union). */
interface ServerEventFrame {
  type: string;
  state?: "idle" | "running" | "compacting";
  toolCall?: OmniMessage<ToolCallPayload>;
  origin?: string[];
  /** goal_finished: how the goal ended and its counters (the server maps the goal hook's stop event to this). */
  outcome?: GoalOutcome["outcome"];
  rounds?: number;
  used?: number;
}

/** How a goal ended plus its counters, as the server's goal_finished event reports them. */
export interface GoalOutcome {
  outcome: "complete" | "blocked" | "budget_limited" | "aborted";
  /** Rounds actually run (the wrap-up round counts). */
  rounds: number;
  tokensUsed: number;
}

/**
 * A Session's SSE subscription with Last-Event-ID reconnects. `next()` yields frames
 * across reconnects; `close()` ends it. A subscription that drops MID-TASK reconnects
 * up to `MAX_RECONNECTS` times with a short backoff (the counter resets whenever a
 * frame actually arrives); a still-failing stream throws to the consumer.
 */
export class SessionStream {
  private lastEventId: string | undefined;
  private closed = false;
  private readonly abort = new AbortController();
  private iterator: AsyncGenerator<SseFrame> | null = null;
  private attempts = 0;

  private static readonly MAX_RECONNECTS = 5;

  constructor(
    private readonly client: ServerClient,
    private readonly sessionId: string,
    private readonly t: Messages,
  ) {}

  close(): void {
    this.closed = true;
    this.abort.abort();
  }

  /** The next frame, reconnecting through connection drops; null once closed. */
  async next(): Promise<SseFrame | null> {
    for (;;) {
      if (this.closed) return null;
      if (this.iterator === null) {
        this.iterator = this.client.sse(`/api/sessions/${this.sessionId}/stream`, {
          ...(this.lastEventId !== undefined ? { lastEventId: this.lastEventId } : {}),
          signal: this.abort.signal,
        });
      }
      try {
        const { done, value } = await this.iterator.next();
        if (done) {
          // Server closed the stream (restart/shutdown): treat like a drop and retry.
          this.iterator = null;
          await this.backoff();
          continue;
        }
        this.attempts = 0;
        if (value.id !== undefined) this.lastEventId = value.id;
        return value;
      } catch (err) {
        if (this.closed) return null;
        this.iterator = null;
        await this.backoff(err);
      }
    }
  }

  private async backoff(err?: unknown): Promise<void> {
    this.attempts += 1;
    if (this.attempts > SessionStream.MAX_RECONNECTS) {
      const detail = err instanceof Error ? err.message : String(err ?? "connection lost");
      throw new Error(this.t.client.streamLost(detail));
    }
    await new Promise((resolve) => setTimeout(resolve, 300 * this.attempts));
  }

  /**
   * Consumes frames until the initial `task_state` snapshot arrives (the first event of
   * every subscription) and returns its state — the authoritative "is it running"
   * answer callers branch on before POSTing.
   */
  async waitReady(): Promise<"idle" | "running" | "compacting"> {
    for (;;) {
      const frame = await this.next();
      if (frame === null) throw new Error(this.t.client.streamLost("closed before ready"));
      if (frame.event !== "server_event") continue;
      const ev = JSON.parse(frame.data) as ServerEventFrame;
      if (ev.type === "task_state" && ev.state !== undefined) return ev.state;
    }
  }
}

export interface WatchTaskOptions {
  client: ServerClient;
  sessionId: string;
  t: Messages;
  /** Renders the stream; omit for `--json` runs (messages are still parsed for text collection). */
  renderer?: StreamRenderer;
  /**
   * Answers an `approval_request` (the [Y/n] prompt); the decision is POSTed back.
   * Absent = the request is left pending untouched — a passive watcher (the poll form,
   * `--json` collectors) must never decide another surface's approvals.
   */
  approvalPrompt?: (tc: OmniMessage<ToolCallPayload>) => Promise<ApprovalDecision>;
  /** Goal mode: receives the dim round/summary lines (same rhythm as the core-direct loop had); a minimal sink so --json can swallow them. */
  goal?: { out: { write(text: string): unknown } };
  /** Collects main-session assistant text (complete messages) for `--json` output. */
  onAssistantText?: (text: string) => void;
  /**
   * `--timeout` soft-yield deadline (epoch ms): once it passes, the watch detaches
   * cleanly and reports `timedOut` — the exec_command yield-window semantics, applied to
   * the wait rather than the task. The task keeps running server-side; nothing is
   * aborted. Absent = wait indefinitely.
   */
  deadlineMs?: number;
}

/** Result of one watched task. */
export interface WatchTaskResult {
  /** The task ended with a main-session abort event (user interrupt / LLM failure). */
  aborted: boolean;
  /** The `deadlineMs` budget expired before the task ended: the watch detached, the task runs on. */
  timedOut: boolean;
  /** Goal-mode outcome (absent when the stream ended before the terminal event). */
  goal?: GoalOutcome;
}

/**
 * One frame, racing the soft-yield deadline: "timeout" once `deadlineMs` passes. The
 * losing `stream.next()` stays pending against the stream's internal iterator — the
 * caller detaches by closing the stream, which settles it. Shared by watchTask and
 * `logs -f`.
 */
export async function nextFrameOrDeadline(
  stream: SessionStream,
  deadlineMs: number | undefined,
): Promise<SseFrame | null | "timeout"> {
  if (deadlineMs === undefined) return stream.next();
  const remaining = deadlineMs - Date.now();
  if (remaining <= 0) return "timeout";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), remaining);
  });
  try {
    return await Promise.race([stream.next(), expiry]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Consumes the stream until the task ends (`task_state` returns to idle). Call it AFTER
 * `waitReady()` and after POSTing the task/steer — every `task_state` seen here is a
 * flip, so the first `idle` is the end.
 */
export async function watchTask(
  stream: SessionStream,
  opts: WatchTaskOptions,
): Promise<WatchTaskResult> {
  const { t, renderer } = opts;
  let aborted = false;
  let timedOut = false;
  let outcome: GoalOutcome | undefined;
  let round = 0;
  let segmentStartedAt = Date.now();
  // Approval prompts serialize on a promise chain: concurrent requests (parent +
  // subagent) must not interleave their Q&A on one stdin.
  let promptChain: Promise<unknown> = Promise.resolve();

  const answerApproval = (ev: ServerEventFrame): void => {
    const tc = ev.toolCall;
    if (tc === undefined || opts.approvalPrompt === undefined) return;
    const prompt = opts.approvalPrompt;
    const run = async (): Promise<void> => {
      let decision: ApprovalDecision = "deny";
      renderer?.beginUserPrompt(tc);
      try {
        decision = await prompt(tc);
      } finally {
        // The decision line renders before the screen unlocks, keeping
        // call → prompt → result adjacent (same contract as the core-direct loop).
        renderer?.noteApprovalDecision(tc, decision);
        renderer?.endUserPrompt();
      }
      try {
        await opts.client.request(
          "POST",
          `/api/sessions/${opts.sessionId}/approvals/${encodeURIComponent(tc.payload.tool_call_id)}`,
          { decision },
        );
      } catch {
        // Already decided (abort converged it) or the run ended: nothing to do.
      }
    };
    promptChain = promptChain.then(run, run);
  };

  for (;;) {
    const frame = await nextFrameOrDeadline(stream, opts.deadlineMs);
    if (frame === "timeout") {
      timedOut = true;
      break;
    }
    if (frame === null) break;
    if (frame.event === "server_event") {
      const ev = JSON.parse(frame.data) as ServerEventFrame;
      if (ev.type === "task_state" && ev.state === "idle") break;
      if (ev.type === "approval_request") answerApproval(ev);
      if (ev.type === "goal_finished" && ev.outcome !== undefined) {
        outcome = { outcome: ev.outcome, rounds: ev.rounds ?? 0, tokensUsed: ev.used ?? 0 };
      }
      if (ev.type === "resync_required") {
        renderer?.printLine(dim(t.client.streamResynced()));
      }
      continue;
    }
    if (frame.event !== undefined) continue; // unknown named events: skip
    const msg = JSON.parse(frame.data) as OmniMessage;
    if (isEventMessage(msg) && msg.payload.type === "abort" && (msg.origin?.length ?? 0) === 0) {
      aborted = true;
    }
    if (opts.goal) {
      // A harness-injected input is a round boundary: round 1's protocol message (sent
      // right behind the objective), then every stop-hook continue. Background completion
      // notices share the stamp but ride inside a round — same exclusion as the server's
      // goal_round events.
      const text = (msg.payload as { text?: string }).text ?? "";
      if (isHarnessInput(msg) && parseBackgroundTaskDoneMessage(text) === null) {
        if (round > 0) renderer?.endTask(Date.now() - segmentStartedAt);
        round++;
        segmentStartedAt = Date.now();
        opts.goal.out.write(`${dim(t.goalRound(round))}\n`);
      }
    }
    if (opts.onAssistantText && (msg.origin?.length ?? 0) === 0 && isModelMessage(msg)) {
      const p = msg.payload as { type?: string; role?: string; text?: string };
      if (p.type === "text" && p.role !== "user" && typeof p.text === "string") {
        opts.onAssistantText(p.text);
      }
    }
    renderer?.handle(msg);
  }
  // Settle any prompt still in flight (the run ended while a question was open).
  await promptChain.catch(() => undefined);
  renderer?.endTask(Date.now() - segmentStartedAt);
  if (opts.goal && outcome) {
    opts.goal.out.write(
      `${dim(t.goalFinished(outcome.outcome, outcome.rounds, humanizeTokens(outcome.tokensUsed)))}\n`,
    );
  }
  return { aborted, timedOut, ...(outcome !== undefined ? { goal: outcome } : {}) };
}
