/**
 * The organization scheduler: a Web server runtime component, alive only while the
 * server runs, shaped like the schedule scheduler — one reconcile pass at start (no
 * backfill), then a periodic tick over every organization of every Project. A route
 * write asks for an immediate pass of just its organization, so API changes take effect
 * now while hand edits wait for the next tick. The admin switch is read every tick: off
 * means the pass still refreshes caches but fires nothing.
 */
import type { OrgDeps } from "./deps.js";
import { KeyedLocks, orgLockKey } from "./locks.js";
import { reconcileOrg } from "./reconcile.js";
import type { ReconcileResult } from "./reconcile.js";

/** Same cadence as schedules: the calendar's minimum period is 5m, so 30s is plenty. */
const TICK_INTERVAL_MS = 30_000;

export class OrganizationScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private readonly intervalMs: number;
  private readonly gates = new Map<string, MentionGate>();
  readonly locks = new KeyedLocks();

  constructor(
    private readonly deps: OrgDeps,
    opts: { intervalMs?: number } = {},
  ) {
    this.intervalMs = opts.intervalMs ?? TICK_INTERVAL_MS;
  }

  /**
   * The periodic pass, and one pass now — the returned promise is that first pass. The tick is
   * armed first, so a stop that comes while the pass runs leaves nothing armed.
   */
  async start(): Promise<void> {
    this.timer = setInterval(() => {
      void this.tickOnce();
    }, this.intervalMs);
    this.timer.unref?.();
    await this.tickOnce();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass over every organization (deterministic entry for tests; concurrent calls run only one). */
  async tickOnce(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const triggers = this.deps.companyModeEnabled();
      for (const project of this.deps.projects.listAll()) {
        for (const orgId of await this.deps.store.listOrgIds(project.projectId)) {
          try {
            await this.reconcile(project.projectId, orgId, { triggers });
          } catch (err) {
            this.deps.errors.record({
              source: "organization",
              err,
              code: "org_tick_failed",
              ctx: { projectId: project.projectId },
            });
          }
        }
      }
    } catch (err) {
      this.deps.errors.record({ source: "organization", err, code: "org_tick_failed" });
    } finally {
      this.ticking = false;
    }
  }

  /** Immediate-effect entry after a route write: one organization, serialized with the tick. */
  reconcile(
    projectId: string,
    orgId: string,
    opts: { triggers?: boolean } = {},
  ): Promise<ReconcileResult | null> {
    return this.locks.run(orgLockKey(projectId, orgId), () =>
      reconcileOrg(this.deps, projectId, orgId, {
        triggers: opts.triggers ?? this.deps.companyModeEnabled(),
        gate: this.gate(projectId, orgId),
      }),
    );
  }

  /** Runs a write under the organization's lock so it never interleaves with a pass. */
  withLock<T>(projectId: string, orgId: string, fn: () => Promise<T>): Promise<T> {
    return this.locks.run(orgLockKey(projectId, orgId), fn);
  }

  /**
   * The mention rate budgets of one organization, created on first use and kept for the
   * scheduler's lifetime. Entries of organizations that are later deleted linger until the
   * process restarts; they hold a few arrays of timestamps and touch nothing, so they are
   * not worth a delete hook.
   */
  private gate(projectId: string, orgId: string): MentionGate {
    const key = `${projectId}/${orgId}`;
    let gate = this.gates.get(key);
    if (gate === undefined) {
      gate = new MentionGate();
      this.gates.set(key, gate);
    }
    return gate;
  }
}

/**
 * The mention rate budgets, in memory: how many times one pair of employees has woken each
 * other, and how many desks one sender has woken, each as a list of delivery timestamps per
 * organization. Nothing survives a restart or a hot push — the window is an hour or so, so
 * a wiped ledger lets at most one window's worth of wakes through early, which is the price
 * of not paying for a table and a swapSafe migration. Timestamps come from the caller (the
 * reconcile pass reads the same clock as everything else), and entries outside the window
 * are dropped whenever the list is read or written.
 */
export class MentionGate {
  private readonly pairs = new Map<string, number[]>();
  private readonly senders = new Map<string, number[]>();

  private static within(ts: number[] | undefined, nowMs: number, windowMs: number): number[] {
    if (ts === undefined) return [];
    const keep = ts.filter((t) => nowMs - t < windowMs);
    if (keep.length !== ts.length) ts.splice(0, ts.length, ...keep);
    return keep;
  }

  /** How many times this unordered pair has woken each other within the window. */
  pairCount(key: string, a: string, b: string, nowMs: number, windowMs: number): number {
    const [x, y] = a < b ? [a, b] : [b, a];
    return MentionGate.within(this.pairs.get(`${key}\u0000${x}|${y}`), nowMs, windowMs).length;
  }

  /** How many desks this sender has woken by mention within the window. */
  senderCount(key: string, sender: string, nowMs: number, windowMs: number): number {
    return MentionGate.within(this.senders.get(`${key}\u0000${sender}`), nowMs, windowMs).length;
  }

  /** Counts one delivered wake: the unordered pair, and the sender's fan-out. */
  count(key: string, sender: string, target: string, nowMs: number): void {
    const [x, y] = sender < target ? [sender, target] : [target, sender];
    const pairKey = `${key}\u0000${x}|${y}`;
    const pair = this.pairs.get(pairKey);
    if (pair === undefined) this.pairs.set(pairKey, [nowMs]);
    else pair.push(nowMs);
    const senderKey = `${key}\u0000${sender}`;
    const senderTs = this.senders.get(senderKey);
    if (senderTs === undefined) this.senders.set(senderKey, [nowMs]);
    else senderTs.push(nowMs);
  }
}
