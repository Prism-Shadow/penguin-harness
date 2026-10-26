/**
 * `WorkbenchHost.subscribe`: a workbench's handler following a Session of its Project live.
 *
 * A listener receives what the cookie door's AMSP stream (`GET /api/sessions/:id/amsp`) writes of
 * the same channel — every record, partial deltas and a subagent's (`origin`) included, none of
 * the Web App's server events ({@link isAmspRecord}) — each parsed afresh for its subscription,
 * so one listener cannot change what another one reads. Live only: nothing is replayed and there
 * is no id to resume from; what happened before is `sessionResult`'s to answer.
 *
 * The handler is code an Agent wrote, so it never runs inside the publish that produced a record:
 * a Session publishes from its own run loop, and a listener that threw, blocked, or started
 * another run there would do it in the middle of that loop. Each record is handed over in a
 * microtask, in order. A listener that throws, or returns a promise that rejects, is logged once
 * per subscription (a listener failing on every partial delta would otherwise flood the log) and
 * the subscription carries on.
 *
 * A subscription holds its Session's channel — the hub never reclaims a channel somebody listens
 * on — so none outlives its reason to exist: all of a tree's subscriptions end when the tree is
 * disposed (a reload, a removal, the platform going away; ./service.ts), and one whose Session
 * has sat idle with nothing published for {@link IDLE_RELEASE_MS} ends by itself, leaving the
 * channel to the hub's own idle reclaim.
 */
import type { Channels } from "../hmr/capabilities.js";
import { isAmspRecord } from "../http/sse.js";
import type { WorkbenchRecord } from "../mechanisms/workbenches.js";

/** An idle Session's subscription that has seen nothing for this long ends: the hub's own idle window. */
export const IDLE_RELEASE_MS = 30 * 60 * 1000;
/** How often open subscriptions are checked against {@link IDLE_RELEASE_MS}. */
const SWEEP_MS = 60 * 1000;

export interface WorkbenchSubscriptionDeps {
  channels: Pick<Channels, "get">;
  /** The Session's run status; `idle` when no task runs. */
  statusOf(sessionId: string): string;
  /** Milliseconds since the epoch. */
  now(): number;
  /** One line to the server log; the caller prefixes the workbench. */
  log(line: string): void;
}

interface Subscription {
  sessionId: string;
  /** When the channel last published anything this subscription saw, or when it opened. */
  lastSeen: number;
  end(): void;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/** The subscriptions of one workbench tree. */
export class WorkbenchSubscriptions {
  private readonly open = new Set<Subscription>();
  private sweeper: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(private readonly deps: WorkbenchSubscriptionDeps) {}

  /**
   * Subscribes `listener` to the Session's records; the caller has checked the Session is the
   * Project's. On a tree already disposed — a request still finishing on the instance a reload
   * replaced — the subscription has ended before it began: nothing is held, nothing delivered.
   */
  subscribe(sessionId: string, listener: (record: WorkbenchRecord) => void): () => void {
    if (typeof listener !== "function") {
      throw new Error("subscribe: the listener must be a function");
    }
    if (this.closed) return () => {};
    let active = true;
    let reported = false;
    const failed = (err: unknown): void => {
      if (reported) return;
      reported = true;
      this.deps.log(
        `subscribe(${sessionId}): the listener failed: ${messageOf(err)} (later failures of this subscription are not logged)`,
      );
    };
    const deliver = (data: string): void => {
      if (!active) return;
      try {
        const out: unknown = listener(JSON.parse(data) as WorkbenchRecord);
        if (isThenable(out)) out.then(undefined, failed);
      } catch (err) {
        failed(err);
      }
    };
    const sub: Subscription = { sessionId, lastSeen: this.deps.now(), end: () => {} };
    const off = this.deps.channels.get(sessionId).subscribe((evt) => {
      sub.lastSeen = this.deps.now();
      if (!isAmspRecord(evt)) return;
      const data = evt.data;
      queueMicrotask(() => deliver(data));
    });
    sub.end = () => {
      if (!active) return;
      active = false;
      off();
      this.open.delete(sub);
      if (this.open.size === 0) this.stopSweeper();
    };
    this.open.add(sub);
    if (this.sweeper === null) {
      this.sweeper = setInterval(() => this.sweep(), SWEEP_MS);
      this.sweeper.unref?.();
    }
    return sub.end;
  }

  /** Ends each subscription whose Session is idle and has published nothing for {@link IDLE_RELEASE_MS}. */
  sweep(): void {
    const now = this.deps.now();
    for (const sub of [...this.open]) {
      if (now - sub.lastSeen < IDLE_RELEASE_MS) continue;
      if (this.deps.statusOf(sub.sessionId) !== "idle") continue;
      this.deps.log(
        `subscribe(${sub.sessionId}): ended, the Session has been idle with nothing published for ${IDLE_RELEASE_MS / 60_000} minutes`,
      );
      sub.end();
    }
  }

  /** Ends every subscription, and any made later: the tree they belong to is gone. */
  close(): void {
    this.closed = true;
    for (const sub of [...this.open]) sub.end();
    this.stopSweeper();
  }

  private stopSweeper(): void {
    if (this.sweeper !== null) clearInterval(this.sweeper);
    this.sweeper = null;
  }
}
