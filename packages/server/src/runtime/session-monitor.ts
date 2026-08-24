/**
 * SessionMonitor — the per-session MONITOR (管程): one object per session that owns ALL
 * of its run state (status, approvals, interrupt, queues, mirrors) and serializes every
 * operation on it. Nothing outside this pair of files touches that state: routes and
 * services go through SessionManager's facade, which delegates here, and the state
 * fields below are written only by generation code invoked FROM a monitor operation.
 *
 * The monitor is also the hot-swap unit. It survives a platform swap by riding the
 * resource registry (the shared monitors table — see AGENT_SESSIONS_RESOURCE_ID in
 * hmr/platform.ts), and it holds TWO generation pointers:
 *
 *   current — the generation whose code serves this session's events (its SessionManager,
 *             acting as this monitor's procedure set: launch, drive, publish, resume);
 *   pending — the next generation, set by its SessionManager at adoption (`setPending`).
 *
 * The replacement rule is the event-boundary rule: after all previously accepted events
 * complete, the old code pointer is replaced by the new one and the NEXT event is
 * processed by the new generation. An idle monitor swaps immediately (its events are all
 * complete); a monitor with a run in flight swaps when that run settles (completeRun).
 * The in-flight run itself keeps running on the old generation's closures — a lame duck,
 * shortened by the engine's turn-boundary park (see GenerationOps.retire) — and its
 * parked continuation is then processed by the NEW generation like any next event.
 *
 * The loaded RuntimeSession belongs to the CODE side of that rule, not the state side:
 * its durable state is the Trace, so a pointer swap disposes it and the next event
 * reloads through the new generation's loader. Queues and mirrors (follow-ups, pending
 * inputs) are state and stay in the monitor across generations.
 *
 * This class must stay SMALL and STABLE: policy lives behind `current` and is therefore
 * always current-generation; what is coded here is only state, mutual exclusion, and the
 * pointer-swap rule. Its public member list is a declared resource interface
 * (DECLARED_RESOURCES in hmr/platform.ts) — an incompatible successor hard-stops the
 * whole table rather than adopting monitors it cannot speak to.
 */
import type { OmniMessage, ThinkingLevelName } from "@prismshadow/penguin-core";
import type { PendingFollowUpInfo, PendingSteeringInfo, SessionStatus } from "../api/types.js";
import { ApprovalRegistry } from "./approvals.js";
import type { RecallStore, RuntimeSession } from "./session-manager.js";

/** One queued follow-up task (`queueIfBusy`): the task input plus the per-turn thinking level it was posted with. */
export interface QueuedFollowUp {
  /** Recall handle (PendingFollowUpInfo.id), assigned at queue time. */
  id: string;
  input: OmniMessage[];
  thinkingLevel?: ThinkingLevelName;
  /** Original content for recall; absent when the queueing path predates or bypasses the route (recall then returns 409). */
  recall?: RecallStore;
}

/** One undelivered steering entry: the display info broadcast on task_state, plus what a recall needs — the exact input list core queued (its unsteer handle) and the original content. */
export interface PendingSteeringEntry {
  info: PendingSteeringInfo;
  input: OmniMessage[];
  recall: RecallStore;
}

/** The `task_state` display info of one queued follow-up (see PendingFollowUpInfo); an entry queued without a recall store truthfully reports empty content. */
export function followUpInfo(f: QueuedFollowUp): PendingFollowUpInfo {
  return {
    id: f.id,
    text: f.recall?.text ?? "",
    images: f.recall?.images.length ?? 0,
    files: f.recall?.files.length ?? 0,
  };
}

/**
 * The procedures a generation attaches to a monitor — implemented by that generation's
 * SessionManager. Everything here is POLICY and is reached through the monitor's
 * `current` pointer, so it is replaced by a swap; the monitor itself never encodes any
 * of it. Each `run*` procedure is invoked from inside the monitor's mutex (see enter)
 * and receives the monitor as its state.
 */
export interface GenerationOps {
  /** startTask body (guards → ensure session → queue-or-launch); mutex held by the caller. */
  runStartTask(
    m: SessionMonitor,
    input: OmniMessage[],
    opts?: { thinkingLevel?: ThinkingLevelName; queueIfBusy?: boolean; recall?: RecallStore },
  ): Promise<{ sessionId: string; queued: boolean }>;
  /** startGoal body; mutex held by the caller. */
  runStartGoal(
    m: SessionMonitor,
    args: { input: OmniMessage[]; budget: number; thinkingLevel?: ThinkingLevelName },
  ): Promise<{ sessionId: string }>;
  /** startCompact body; mutex held by the caller. */
  runStartCompact(m: SessionMonitor): Promise<{ sessionId: string }>;
  /** atIdleBoundary body; mutex held by the caller. */
  runAtIdleBoundary<T>(m: SessionMonitor, operation: () => Promise<T>): Promise<T>;
  /**
   * Auto-start procedures (mutex held by the caller; guards are early returns, never
   * throws): the parked continuation of a handed-off run, the next queued follow-up,
   * and queued background completion notices.
   */
  runResume(m: SessionMonitor): Promise<void>;
  runNextFollowUp(m: SessionMonitor): Promise<void>;
  runBackgroundNotices(m: SessionMonitor): Promise<void>;
}

export class SessionMonitor {
  readonly projectId: string;
  readonly agentId: string;
  /** Vendor grouping for the Session's model (paired with modelId to form a model reference). */
  readonly provider: string;
  readonly modelId: string;
  /** Current session id (self-heal rebuilds may replace it — see SessionManager.rekeyMonitor). */
  sessionId: string;

  // —— Run state. Written ONLY by generation code invoked from a monitor operation
  // (the module doc's discipline); read through the accessors below everywhere else. ——
  session: RuntimeSession | null = null;
  /** Agent config generation `session` was loaded under (vault invalidation compares it). */
  generation = 0;
  status: SessionStatus = "idle";
  readonly approvals = new ApprovalRegistry();
  abort: AbortController | null = null;
  /** The in-flight drive Promise (its settle is the event boundary). */
  running: Promise<void> | null = null;
  /**
   * Turn-boundary handoff state of the current run, set at launch for plain Task runs
   * only — goals and compactions stay null and are hard-aborted at retire(). `requested`
   * is flipped by retire(); the run's `shouldPark` callback reads it at every turn
   * boundary and records the park in `parked`, which completeRun turns into the resume
   * event.
   */
  handoff: { requested: boolean; parked: boolean } | null = null;
  /** Queued follow-up tasks (`queueIfBusy`); deliberately kept across aborts AND generation swaps — they are future events. */
  followUps: QueuedFollowUp[] = [];
  /** The running Task's input messages, held until the Trace catches up (see SessionManager.pendingInputs). */
  pendingInputs: OmniMessage[] = [];
  /** The running Task's streamed bootstrap records (see SessionManager.pendingBootstrap). */
  pendingBootstrap: OmniMessage[] = [];
  /** Display mirror of core's undelivered steering queue (see SessionManager.pendingSteeringOf). */
  pendingSteering: PendingSteeringEntry[] = [];
  /** Timestamp of last activity (refreshed on load / status flip / drive completion), used for idle-eviction checks. */
  lastActivityMs = Date.now();

  private current: GenerationOps;
  private pending: GenerationOps | null = null;
  /** The monitor mutex: every operation chains here (the former per-session lock table). */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    ops: GenerationOps,
    row: {
      sessionId: string;
      projectId: string;
      agentId: string;
      provider: string;
      modelId: string;
    },
  ) {
    this.current = ops;
    this.sessionId = row.sessionId;
    this.projectId = row.projectId;
    this.agentId = row.agentId;
    this.provider = row.provider;
    this.modelId = row.modelId;
  }

  /** Serializes an operation on this session's state (mutual exclusion at the monitor boundary). */
  private async enter<T>(fn: () => Promise<T>): Promise<T> {
    // The chain always holds a pre-caught promise: it only sequences; callers get the
    // original outcome from `next`.
    const next = this.chain.then(fn);
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  /**
   * The event-boundary pointer swap: with no run in flight, the pending generation (if
   * any) becomes current, and the loaded session — old generation code — is dropped; the
   * next event reloads through the new generation's loader, with the Trace as the state.
   * A no-op mid-run: completeRun calls back here at the run's settle.
   */
  private swapIfIdle(): void {
    if (this.pending === null || this.running !== null) return;
    this.current = this.pending;
    this.pending = null;
    this.session?.dispose?.();
    this.session = null;
  }

  /**
   * Attaches the next generation (called by its SessionManager at adoption). An idle
   * monitor swaps immediately — all previously accepted events are complete, so the
   * boundary is now; a busy one swaps when its run settles.
   */
  setPending(ops: GenerationOps): void {
    this.pending = ops;
    void this.enter(async () => {
      this.swapIfIdle();
    });
  }

  /**
   * The dying generation's exit call (its manager's quiesce): ask a parkable run to park
   * at its next turn boundary; hard-abort anything without a park contract (goals,
   * compactions). Returns the in-flight drive for the swap's drain when it was aborted —
   * a parked run deliberately outlives the swap and must not gate the successor's boot.
   */
  retire(): { aborted: Promise<void> | null } {
    if (this.running === null) return { aborted: null };
    if (this.handoff !== null) {
      this.handoff.requested = true;
      return { aborted: null };
    }
    this.interrupt();
    return { aborted: this.running };
  }

  /**
   * The run-settle boundary, called by the driving generation at the very end of its
   * drive's finally (after the state resets and the idle broadcast): swap the code
   * pointer if a generation is waiting, then schedule the next event ON THE (possibly
   * new) CURRENT generation — the parked continuation of a handed-off run, else the next
   * queued follow-up, else raced background notices. `parked` is computed by the driver
   * before it clears the abort controller (park consumed AND not interrupted).
   */
  completeRun(parked: boolean): void {
    void this.enter(async () => {
      this.swapIfIdle();
      if (parked) await this.current.runResume(this);
      else if (this.followUps.length > 0) await this.current.runNextFollowUp(this);
      else await this.current.runBackgroundNotices(this);
    });
  }

  /** Delivery trigger for queued background completion notices (the session's idle-arrival signal). */
  backgroundNotices(): void {
    void this.enter(async () => {
      this.swapIfIdle();
      await this.current.runBackgroundNotices(this);
    });
  }

  /**
   * The generation a NEW event is submitted to: the pending one when a swap is waiting —
   * the dying generation refuses work (its closed flag), and per the boundary rule the
   * next event belongs to the successor anyway. With the monitor idle, enter() has
   * already swapped, so both pointers agree.
   */
  private ops(): GenerationOps {
    return this.pending ?? this.current;
  }

  // —— Serialized policy operations (delegated to the current generation) ——

  startTask(
    input: OmniMessage[],
    opts?: { thinkingLevel?: ThinkingLevelName; queueIfBusy?: boolean; recall?: RecallStore },
  ): Promise<{ sessionId: string; queued: boolean }> {
    return this.enter(() => {
      this.swapIfIdle();
      return this.ops().runStartTask(this, input, opts);
    });
  }

  startGoal(args: {
    input: OmniMessage[];
    budget: number;
    thinkingLevel?: ThinkingLevelName;
  }): Promise<{ sessionId: string }> {
    return this.enter(() => {
      this.swapIfIdle();
      return this.ops().runStartGoal(this, args);
    });
  }

  startCompact(): Promise<{ sessionId: string }> {
    return this.enter(() => {
      this.swapIfIdle();
      return this.ops().runStartCompact(this);
    });
  }

  atIdleBoundary<T>(operation: () => Promise<T>): Promise<T> {
    return this.enter(() => {
      this.swapIfIdle();
      return this.ops().runAtIdleBoundary(this, operation);
    });
  }

  // —— Stable state operations (no generation code involved) ——

  /** Interrupt the current run: pending approvals converge to deny first, then the AbortSignal fires. */
  interrupt(): boolean {
    if (this.abort === null) return false;
    this.approvals.denyAll();
    this.abort.abort();
    return true;
  }

  currentStatus(): SessionStatus {
    return this.status;
  }

  /**
   * Whether the idle sweep may evict this monitor: nothing in flight, nothing queued,
   * nothing pinned by the live session (background processes / subagents / notices), and
   * inactive past the timeout. Eviction is memory reclamation only — the next access
   * recreates the monitor and reloads through the loader.
   */
  evictable(now: number, idleMs: number): boolean {
    if (this.status !== "idle" || this.approvals.size !== 0 || this.running !== null) return false;
    if (this.followUps.length > 0) return false;
    // A live background process (a dev server the conversation started) pins the monitor:
    // eviction would strand it — the reloaded Session starts with a fresh environment, so
    // the process list and its stop control would go blind while the OS process kept
    // running. Same for a working background subagent and undelivered completion notices,
    // which live in the very Session object eviction would drop.
    if (this.session?.listBackgroundCommands?.().some((p) => p.running)) return false;
    if (this.session?.hasRunningBackgroundSubagents?.()) return false;
    if (this.session?.hasPendingBackgroundNotices?.()) return false;
    return now - this.lastActivityMs > idleMs;
  }

  /** Releases the loaded session (kills its background processes), after the in-flight drive settles. */
  disposeWhenSettled(): void {
    const session = this.session;
    const dispose = (): void => session?.dispose?.();
    if (this.running) void this.running.then(dispose, dispose);
    else dispose();
  }
}
