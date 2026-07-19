/**
 * BackgroundRegistry —— generic registry for background sessions, shared by command sessions
 * and subagent sessions.
 *
 * Responsibilities: allocating and managing background session ids, enforcing the concurrency
 * cap, reclaiming idle sessions, uniform finalization when the Session/Environment ends, and a
 * hard kill on process 'exit' as a fallback (JS has no destructors, so cleanup must be explicit).
 * Background sessions living for days at a time are a legitimate form; idle reclamation is only
 * a leak fallback — sessions unaccessed for longer than `IDLE_TTL_MS` are finalized by a
 * periodic sweep.
 *
 * The two concurrency-cap strategies are expressed by how `makeRoom` is called:
 * - Command sessions: if full at registration time, prefer evicting exited sessions, otherwise
 *   evict LRU (killing a background process is an acceptable cost);
 * - Subagent sessions: `makeRoom` is called before launch (only evicting completed, idle ones);
 *   if there's no room, spawning is rejected — evicting a running subagent is equivalent to
 *   discarding in-progress work, which is semantically unacceptable.
 *
 * No lock is needed under the single-threaded event loop; but note the registry may change
 * across an `await`, so check before using an entry.
 * Docs: /docs/tools § "Background session caps".
 */
import { randomUUID } from "node:crypto";

/** Idle reclamation TTL (milliseconds): a session unaccessed for longer than this is treated as a leak and reclaimed. */
const IDLE_TTL_MS = 10 * 24 * 60 * 60_000; // 10 days
/** Idle reclamation check interval (milliseconds): TTL is measured in days, so an hourly sweep is sufficient. */
const IDLE_SWEEP_MS = 60 * 60_000;

/** Minimal contract a background session must satisfy to be managed by the registry. */
export interface BackgroundTask {
  /** Timestamp of the most recent access (used for LRU eviction); refreshed by the registry on register/get. */
  lastUsed: number;
  /** Whether the session is still running (determines eviction priority). */
  running: boolean;
  /** Asynchronous finalization (SIGTERM -> SIGKILL / abort); idempotent. */
  kill(): void;
  /** Synchronous hard kill (process 'exit' fallback path: the event loop has stopped, timers are unavailable). */
  killHard(): void;
}

// process 'exit' fallback: use a single module-level listener to manage all registries, avoiding
// each Session adding its own listener and triggering EventEmitter's MaxListeners warning.
const LIVE_REGISTRIES = new Set<BackgroundRegistry<BackgroundTask>>();
let exitHookInstalled = false;
function ensureExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on("exit", () => {
    for (const r of LIVE_REGISTRIES) r.killAllHard();
  });
}

export class BackgroundRegistry<T extends BackgroundTask> {
  private readonly tasks = new Map<string, T>();
  private readonly idPrefix: string;
  private readonly maxTasks: number;
  private readonly reapTimer: ReturnType<typeof setInterval>;
  private disposed = false;

  constructor(opts: { idPrefix: string; maxTasks: number }) {
    this.idPrefix = opts.idPrefix;
    this.maxTasks = opts.maxTasks;
    LIVE_REGISTRIES.add(this as unknown as BackgroundRegistry<BackgroundTask>);
    ensureExitHook();
    this.reapTimer = setInterval(() => this.reapIdle(), IDLE_SWEEP_MS);
    this.reapTimer.unref?.();
  }

  get size(): number {
    return this.tasks.size;
  }

  /**
   * Makes room for a new session. Returns true immediately if not full; when full, evicts per
   * `evictRunning`:
   * - false (subagent): only evicts the least-recently-used **completed** session; if all are
   *   running, returns false (the caller rejects spawning);
   * - true (command): evicts exited sessions first, otherwise LRU-evicts a running one.
   */
  makeRoom(evictRunning: boolean): boolean {
    if (this.tasks.size < this.maxTasks) return true;
    let lruId: string | null = null;
    let lruUsed = Number.POSITIVE_INFINITY;
    for (const [id, t] of this.tasks) {
      if (!t.running) {
        this.remove(id); // Prefer evicting sessions that have already ended
        return true;
      }
      if (t.lastUsed < lruUsed) {
        lruUsed = t.lastUsed;
        lruId = id;
      }
    }
    if (!evictRunning) return false;
    if (lruId) this.remove(lruId);
    return this.tasks.size < this.maxTasks;
  }

  /**
   * Registers a session, allocating and returning a unique id (`<prefix>-xxxxxxxx`). The caller
   * must first free up room via `makeRoom`. `preferredSuffix` is the preferred id suffix (e.g.
   * the tail of a child Session id, so the tool handle correlates with the message origin/
   * frontend nesting label); falls back to random if omitted or on collision.
   */
  register(task: T, preferredSuffix?: string): string {
    this.ensureActive();
    let id = preferredSuffix ? `${this.idPrefix}-${preferredSuffix}` : this.randomId();
    while (this.tasks.has(id)) id = this.randomId();
    task.lastUsed = Date.now();
    this.tasks.set(id, task);
    return id;
  }

  private randomId(): string {
    return `${this.idPrefix}-${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  }

  /** Looks up a session by id and refreshes its access time; returns undefined if not found. */
  get(id: string): T | undefined {
    if (this.disposed) return undefined;
    const t = this.tasks.get(id);
    if (t) t.lastUsed = Date.now();
    return t;
  }

  /** Removes a session from the registry and finalizes it. */
  remove(id: string): void {
    const t = this.tasks.get(id);
    if (!t) return;
    this.tasks.delete(id);
    t.kill();
  }

  /** Kills and clears all sessions (called when the Session/Environment ends). */
  killAll(): void {
    for (const t of this.tasks.values()) t.kill();
    this.tasks.clear();
  }

  /** Synchronously hard-kills all sessions (process 'exit' fallback path). */
  killAllHard(): void {
    for (const t of this.tasks.values()) t.killHard();
    this.tasks.clear();
  }

  /** Disposes: removes the fallback registration and kills all sessions. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.reapTimer);
    LIVE_REGISTRIES.delete(this as unknown as BackgroundRegistry<BackgroundTask>);
    this.killAll();
  }

  /** Whether the registry has been disposed (the host Session has ended). */
  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Reclaims sessions idle for longer than `IDLE_TTL_MS` (leak fallback, triggered by the periodic sweep). */
  private reapIdle(): void {
    const cutoff = Date.now() - IDLE_TTL_MS;
    for (const [id, t] of this.tasks) {
      if (t.lastUsed <= cutoff) this.remove(id);
    }
  }

  private ensureActive(): void {
    if (this.disposed) {
      throw new Error("background session registry disposed");
    }
  }
}
