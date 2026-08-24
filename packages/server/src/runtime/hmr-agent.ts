/**
 * HmrAgent — the per-session event loop and hot-swap unit.
 *
 * One object per session, riding the resource registry as a shared table (see
 * AGENTS_RESOURCE_ID in hmr/platform.ts) so it survives a platform swap. It owns the
 * session's cross-generation STATE — the event queue, run status, pending approvals, the
 * interrupt controller, display mirrors — and the two code pointers:
 *
 *   current — the generation whose code processes events (its SessionManager, as the
 *             AgentImpl: load, launch, one turn per process call, publish, finish);
 *   pending — the next generation, attached by its SessionManager at adoption
 *             (`setPending`).
 *
 * The pump is the loop: it takes the queue's head event and asks `current` to process it
 * one TURN at a time, checking for a pending generation between calls. That makes every
 * turn boundary a swap point: with no run open the pointer swaps immediately; with one
 * open, the old generation is asked to `suspend` it — the run ends gracefully at the
 * boundary (its durable state is the Trace), the head event degrades to a `continue`
 * remainder, and the NEW generation reloads the session and finishes the work. A run
 * never spans generations, so nothing generation-created crosses a swap except this
 * object and its plain state.
 *
 * Follow-up tasks, a swapped-out run's remainder, and background-notice delivery are all
 * just events in the one queue — the pump replaces the manager's former auto-start
 * paths. Goals and compactions are immediate activities outside the queue (they keep
 * today's 409-when-busy semantics and are hard-aborted rather than suspended at a swap:
 * they have no boundary contract).
 *
 * This class must stay SMALL and STABLE: policy lives behind `current` and is always
 * current-generation; what is coded here is state, the queue discipline, and the
 * swap rule. Its public member list is a declared resource interface (DECLARED_RESOURCES
 * in hmr/platform.ts) — an incompatible successor hard-stops the whole table rather than
 * adopting agents it cannot speak to.
 */
import type { OmniMessage, ThinkingLevelName } from "@prismshadow/penguin-core";
import type { PendingSteeringInfo, SessionStatus } from "../api/types.js";
import { ApprovalRegistry } from "./approvals.js";
import type { RecallStore, RuntimeSession } from "./session-manager.js";

/** One queued unit of work. `task` carries a recall id so a queued follow-up stays recallable. */
export type AgentEvent =
  | {
      type: "task";
      /** Recall handle while queued (PendingFollowUpInfo.id). */
      id: string;
      input: OmniMessage[];
      thinkingLevel?: ThinkingLevelName;
      recall?: RecallStore;
      /**
       * Fired once the run's start (or refusal) is externally visible — the submission
       * awaits it so `startTask` keeps its historical contract: on return, the task has
       * begun (status reads running), not merely been accepted.
       */
      started?: () => void;
    }
  /** The remainder of a run the swap suspended at a turn boundary: reload from the Trace and finish it (keeping the run's thinking level). */
  | { type: "continue"; thinkingLevel?: ThinkingLevelName }
  /** Deliver queued background completion notices as a task (the session's idle-arrival signal). */
  | { type: "notices" };

/** One undelivered steering entry (display mirror; see SessionManager.pendingSteeringOf). */
export interface PendingSteeringEntry {
  info: PendingSteeringInfo;
  input: OmniMessage[];
  recall: RecallStore;
}

/**
 * The code a generation attaches — implemented by its SessionManager. Only the pump
 * calls these, one at a time per agent.
 */
export interface AgentImpl {
  /**
   * Advance the head event by ONE TURN: open the run if this is the first call for the
   * event (task: publish input + begin; continue: reload from Trace + begin with an
   * empty input; notices: drain + begin), else take the next turn of the open run.
   * "more" keeps the event at the head for another call; "done" retires it (the run is
   * closed and the idle state published). Guards (shutdown, deletion) are early "done"s.
   */
  process(agent: HmrAgent, event: AgentEvent): Promise<"more" | "done">;
  /**
   * Swap-out: close the open run gracefully at this turn boundary — endRun, dispose the
   * loaded session (background processes die with its generation) and null it on the
   * agent, keep `status` as-is; the Trace carries the continuation the successor
   * reloads. Returns what the `continue` remainder must keep (the run's thinking level).
   */
  suspend(agent: HmrAgent): { thinkingLevel?: ThinkingLevelName };
}

export class HmrAgent {
  readonly projectId: string;
  readonly agentId: string;
  /** Vendor grouping for the Session's model (paired with modelId to form a model reference). */
  readonly provider: string;
  readonly modelId: string;
  /** Current session id (self-heal rebuilds may replace it — the manager re-keys the table). */
  sessionId: string;

  // —— Cross-generation state. Written only by generation code invoked from the pump or
  // the facade (SessionManager), never from outside the pair. ——
  /** Pending work, processed strictly in order by the pump. The event being processed is NOT in here — see activeEvent. */
  readonly queue: AgentEvent[] = [];
  /** The event the pump is currently processing (taken off the queue), or null. */
  activeEvent: AgentEvent | null = null;
  session: RuntimeSession | null = null;
  /** Agent config generation `session` was loaded under (vault invalidation compares it). */
  generation = 0;
  status: SessionStatus = "idle";
  readonly approvals = new ApprovalRegistry();
  abort: AbortController | null = null;
  /** The in-flight activity kind: queue events run as "task"; goals/compactions occupy the slot directly. */
  activeKind: "task" | "goal" | "compact" | null = null;
  /** The open run's generation-owned bundle (engine refs, per-run scratch); opaque here, never crosses a swap. */
  activeRun: unknown = null;
  /** The in-flight activity's settle promise (deletion/shutdown/drain await it). */
  running: Promise<void> | null = null;
  /** An interrupt that arrived between a suspend and its continue: the next begin finishes as aborted instead of relaunching. */
  interruptRequested = false;
  /** The running Task's input messages, held until the Trace catches up (see SessionManager.pendingInputs). */
  pendingInputs: OmniMessage[] = [];
  /** The running Task's streamed bootstrap records (see SessionManager.pendingBootstrap). */
  pendingBootstrap: OmniMessage[] = [];
  /** Display mirror of core's undelivered steering queue. */
  pendingSteering: PendingSteeringEntry[] = [];
  /** Timestamp of last activity, used for idle-eviction checks. */
  lastActivityMs = Date.now();

  private current: AgentImpl;
  private pending: AgentImpl | null = null;
  private pumping = false;

  constructor(
    impl: AgentImpl,
    row: {
      sessionId: string;
      projectId: string;
      agentId: string;
      provider: string;
      modelId: string;
    },
  ) {
    this.current = impl;
    this.sessionId = row.sessionId;
    this.projectId = row.projectId;
    this.agentId = row.agentId;
    this.provider = row.provider;
    this.modelId = row.modelId;
  }

  /** Enqueue an event and make sure the pump is running. */
  post(event: AgentEvent): void {
    this.queue.push(event);
    this.pump();
  }

  /**
   * Serializes SUBMISSIONS (startTask/startGoal/startCompact/atIdleBoundary): their
   * busy-check → load → accept sequences must not interleave, or two rapid tasks would
   * both read idle and both queue instead of the second 409ing. The pump needs no lock —
   * the queue is its serializer.
   */
  submit<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.submissions.then(fn);
    this.submissions = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
  private submissions: Promise<unknown> = Promise.resolve();

  /**
   * Attach the next generation. With nothing in flight the pointer swaps at the pump's
   * next boundary check — immediately, via the kick below; a busy agent swaps at its
   * next turn boundary (between process calls). Goals/compactions have no boundary:
   * the dying generation's quiesce hard-aborts them instead.
   */
  setPending(impl: AgentImpl): void {
    this.pending = impl;
    this.pump();
  }

  /**
   * The event loop. Single-flight per agent; every iteration is a swap point. The head
   * event stays until its activity reports "done", so an event's turns are consecutive —
   * but a swap between turns retires the old generation's open run (suspend) and
   * degrades the head to a `continue` remainder for the new generation to finish.
   */
  private pump(): void {
    if (this.pumping) return;
    this.pumping = true;
    void (async () => {
      try {
        for (;;) {
          this.swapIfAtBoundary();
          // An immediate activity (goal/compaction) owns the agent: the pump waits for
          // its settle (finishActivity re-kicks).
          if (this.activeKind === "goal" || this.activeKind === "compact") return;
          if (this.activeEvent === null) {
            const next = this.queue.shift();
            if (next === undefined) return;
            this.activeEvent = next;
            this.activeKind = "task";
          }
          let outcome: "more" | "done";
          try {
            outcome = await this.current.process(this, this.activeEvent);
          } catch {
            // process() guards its own failures; a throw here is a defect — retire the
            // event rather than spin on it.
            outcome = "done";
          }
          if (outcome === "done") {
            this.activeEvent = null;
            this.activeKind = null;
          }
        }
      } finally {
        this.pumping = false;
      }
    })();
  }

  /** The swap rule (see the class doc). Called only between process calls — a turn boundary by construction. */
  private swapIfAtBoundary(): void {
    if (this.pending === null) return;
    if (this.activeKind === "goal" || this.activeKind === "compact") return; // quiesce aborts these
    if (this.activeRun !== null) {
      // An interrupted run is never suspended: the abort belongs to this event — one
      // more step lets the run observe the signal and end as aborted (streaming its
      // abort marker), and the swap takes the next boundary instead. Suspending here
      // would resurrect a run the user just stopped.
      if (this.abort?.signal.aborted === true) return;
      // Old generation's open run: close it at this boundary; the active event's
      // remainder continues from the Trace under the new code.
      const remainder = this.current.suspend(this);
      this.activeRun = null;
      this.activeEvent = {
        type: "continue",
        ...(remainder.thinkingLevel !== undefined
          ? { thinkingLevel: remainder.thinkingLevel }
          : {}),
      };
    }
    this.current = this.pending;
    this.pending = null;
    // An idle agent's loaded session is old-generation code with the Trace as its
    // durable state: drop it, the next event reloads through the new loader.
    if (this.activeRun === null && this.session !== null && this.activeKind === null) {
      this.session.dispose?.();
      this.session = null;
    }
  }

  /**
   * Claim the agent for an immediate activity (goal/compaction). The caller has already
   * verified idle; the pump pauses until finishActivity.
   */
  beginActivity(kind: "goal" | "compact"): void {
    this.activeKind = kind;
  }

  /** Release the immediate-activity claim and let the pump resume queued work. */
  finishActivity(): void {
    this.activeKind = null;
    this.pump();
  }

  // —— Stable control surface (no generation code involved) ——

  /**
   * Interrupt the current activity: pending approvals converge to deny first, then the
   * AbortSignal fires. In the gap between a suspend and its continue there is no
   * controller yet — the flag makes the next begin finish as aborted instead. Returns
   * false when nothing is in progress.
   */
  interrupt(): boolean {
    if (this.abort !== null) {
      this.approvals.denyAll();
      this.abort.abort();
      return true;
    }
    if (this.activeEvent?.type === "continue") {
      this.interruptRequested = true;
      return true;
    }
    return false;
  }

  /**
   * Whether the idle sweep may evict this agent: nothing in flight, nothing queued,
   * nothing pinned by the live session (background processes / subagents / notices), and
   * inactive past the timeout. Eviction is memory reclamation only — the next access
   * recreates the agent and reloads through the loader.
   */
  evictable(now: number, idleMs: number): boolean {
    if (this.status !== "idle" || this.approvals.size !== 0 || this.running !== null) return false;
    if (this.queue.length > 0 || this.activeKind !== null) return false;
    // A live background process (a dev server the conversation started) pins the agent:
    // eviction would strand it — the reloaded Session starts with a fresh environment,
    // so the process list and its stop control would go blind while the OS process kept
    // running. Same for a working background subagent and undelivered completion
    // notices, which live in the very Session object eviction would drop.
    if (this.session?.listBackgroundCommands?.().some((p) => p.running)) return false;
    if (this.session?.hasRunningBackgroundSubagents?.()) return false;
    if (this.session?.hasPendingBackgroundNotices?.()) return false;
    return now - this.lastActivityMs > idleMs;
  }

  /** Releases the loaded session (kills its background processes), after the in-flight activity settles. */
  disposeWhenSettled(): void {
    const session = this.session;
    const dispose = (): void => session?.dispose?.();
    if (this.running) void this.running.then(dispose, dispose);
    else dispose();
  }
}
