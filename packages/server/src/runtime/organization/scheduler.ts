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
  readonly locks = new KeyedLocks();

  constructor(
    private readonly deps: OrgDeps,
    opts: { intervalMs?: number } = {},
  ) {
    this.intervalMs = opts.intervalMs ?? TICK_INTERVAL_MS;
  }

  async start(): Promise<void> {
    await this.tickOnce();
    this.timer = setInterval(() => {
      void this.tickOnce();
    }, this.intervalMs);
    this.timer.unref?.();
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
      }),
    );
  }

  /** Runs a write under the organization's lock so it never interleaves with a pass. */
  withLock<T>(projectId: string, orgId: string, fn: () => Promise<T>): Promise<T> {
    return this.locks.run(orgLockKey(projectId, orgId), fn);
  }
}
