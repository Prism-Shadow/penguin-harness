/**
 * The chat's view of one Session: a single subscription, held for as long as the chat is on
 * that Session, through which every run is shown — whoever started it. The chat's own
 * messages, a run another surface (the Web App, another terminal, a schedule) starts, and a
 * run still under way when `--resume` comes to the Session are one path, not three.
 *
 * Joining follows the server's run form of the live tail (`GET /messages?live=run`, see
 * MessagesLiveTail): subscribe first, read the history second, then render the history, the
 * run under way as it was streamed, and the stream past the read's cursor. The server cut the
 * history before that run and holds the run's records itself, so nothing is compared or
 * deduplicated here.
 *
 * A run is followed with watchTask, from the moment the stream leaves idle to the moment it
 * returns to it. While idle, records are not shown (a background subagent's output, say):
 * the prompt owns the screen then.
 */
import { isPartialPayload } from "@prismshadow/penguin-core";
import type { AmspRecord, ApprovalDecision, ToolCallPayload } from "@prismshadow/penguin-core";
import type { MessagesResponse, SessionStatus } from "@prismshadow/penguin-server/api";
import type { ServerClient } from "./client.js";
import type { Messages } from "./i18n.js";
import type { StreamRenderer } from "./render.js";
import { SessionStream, watchTask } from "./server-task.js";

/** What a join found: the history to print, and how the run under way (if any) came back. */
export interface SessionJoin {
  /** The transcript before the run under way; all of it while idle. */
  messages: AmspRecord[];
  /** How many records the conversation holds so far: `messages` and the run's own. */
  count: number;
  /** The run was under way when joined. */
  running: boolean;
  /** Older records of that run the server no longer holds (not shown). */
  omitted: number;
  /** The server answered without the run form (an older server or machine). */
  legacy: boolean;
}

export interface SessionViewOptions {
  client: ServerClient;
  sessionId: string;
  t: Messages;
  /** The renderer runs are drawn with. */
  renderer: () => StreamRenderer;
  /** Asks an approval a followed run waits on. */
  approvalPrompt: (tc: AmspRecord<ToolCallPayload>) => Promise<ApprovalDecision>;
  /** Where a goal's round lines go. */
  out: { write(text: string): unknown };
  /**
   * Called synchronously when the Session leaves idle, before anything of the run is drawn:
   * the prompt makes way for it.
   */
  onBusy: () => void;
}

export class SessionView {
  readonly sessionId: string;
  private state: SessionStatus = "idle";
  /** Runs followed to their end so far (see untilIdle). */
  private ended = 0;
  private closed = false;
  private failure: unknown = null;
  private goalNext = false;
  private waiters: Array<{ after: number; settle: (err: unknown) => void }> = [];
  /** The run under way at the join, as streamed; drawn by start(). */
  private joinedRun: AmspRecord[] = [];

  private constructor(
    private readonly opts: SessionViewOptions,
    private readonly stream: SessionStream,
  ) {
    this.sessionId = opts.sessionId;
  }

  /**
   * Subscribes to the Session and reads its history (subscribe first, read second). The
   * caller prints `messages`, then calls start() to draw the run under way and follow on.
   */
  static async join(opts: SessionViewOptions): Promise<{ view: SessionView; joined: SessionJoin }> {
    const stream = new SessionStream(opts.client, opts.sessionId, opts.t);
    try {
      await stream.waitReady();
      const res = await opts.client.request<MessagesResponse>(
        "GET",
        `/api/sessions/${encodeURIComponent(opts.sessionId)}/messages?live=run`,
      );
      const view = new SessionView(opts, stream);
      const live = res.live;
      // An older server attaches no live tail while idle, and one without `records` while a
      // run is under way; its history then holds the run so far, and the open fragments are
      // all there is to draw of it.
      const legacy = live === undefined || live.records === undefined;
      // The read is later than the snapshot, so its word on the state wins.
      view.state = live?.status ?? (live !== undefined ? "running" : "idle");
      if (live !== undefined) stream.skipThrough(live.cursor);
      view.joinedRun = (legacy ? live?.fragments : live?.records) ?? [];
      // MessagesResponse messages are records plus an optional tracePosition tag the renderer
      // ignores.
      const messages = res.messages as unknown as AmspRecord[];
      const runRecords = legacy ? [] : view.joinedRun;
      return {
        view,
        joined: {
          messages,
          count: messages.length + runRecords.filter((r) => !isPartialPayload(r.payload)).length,
          running: view.state !== "idle",
          omitted: live?.omitted ?? 0,
          legacy,
        },
      };
    } catch (err) {
      stream.close();
      throw err;
    }
  }

  /** Draws the run under way at the join and follows the Session from there. */
  start(): void {
    const renderer = this.opts.renderer();
    for (const record of this.joinedRun) renderer.handle(record);
    this.joinedRun = [];
    void this.follow();
  }

  /** The Session is running a Task or compacting, as far as this view has followed it. */
  get busy(): boolean {
    return this.state !== "idle";
  }

  /** How many runs this view has followed to their end: pass it to untilIdle. */
  get runsEnded(): number {
    return this.ended;
  }

  /** The next run is a goal this chat started: its rounds are announced. */
  expectGoal(goal: boolean): void {
    this.goalNext = goal;
  }

  /**
   * Resolves once a run ends after `after` runs had ended (runsEnded read before a message
   * was sent): the run the message started, steered or queued behind. Also resolves when the
   * view closes; rejects when the stream is lost.
   */
  untilIdle(after: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const settle = (err: unknown): void => (err === null ? resolve() : reject(err));
      this.waiters.push({ after, settle });
      this.settleWaiters();
    });
  }

  /** Ends the subscription; a run under way goes on on the server. */
  close(): void {
    this.closed = true;
    this.stream.close();
    this.settleWaiters();
  }

  private settleWaiters(): void {
    this.waiters = this.waiters.filter((w) => {
      if (this.failure !== null) w.settle(this.failure);
      else if (this.closed || this.ended > w.after) w.settle(null);
      else return true;
      return false;
    });
  }

  private async follow(): Promise<void> {
    const { client, sessionId, t, approvalPrompt, out } = this.opts;
    try {
      for (;;) {
        if (this.state === "idle") {
          const next = await this.nextRun();
          if (next === null) return;
          this.state = next;
          this.opts.onBusy();
        }
        const goal = this.goalNext;
        this.goalNext = false;
        await watchTask(this.stream, {
          client,
          sessionId,
          t,
          renderer: this.opts.renderer(),
          approvalPrompt,
          ...(goal ? { goal: { out } } : {}),
        });
        this.state = "idle";
        this.ended += 1;
        this.settleWaiters();
        if (this.closed) return;
      }
    } catch (err) {
      if (this.closed) return;
      this.failure = err;
      this.settleWaiters();
    }
  }

  /** Waits, while idle, for the Session to leave idle; null once closed. */
  private async nextRun(): Promise<SessionStatus | null> {
    for (;;) {
      const frame = await this.stream.next();
      if (frame === null) return null;
      if (frame.event !== "server_event") continue;
      const ev = JSON.parse(frame.data) as { type?: string; state?: SessionStatus };
      if (ev.type === "task_state" && ev.state !== undefined && ev.state !== "idle") {
        return ev.state;
      }
    }
  }
}
