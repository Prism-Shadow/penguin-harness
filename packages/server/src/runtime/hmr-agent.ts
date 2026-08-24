/**
 * HmrAgent — the per-session event loop, and the unit a hot swap replaces code in.
 *
 * One object per session, riding the resource registry as a shared table (see
 * HMR_AGENTS_RESOURCE_ID in hmr/platform.ts) so it survives a platform swap. It owns
 * everything that must outlive a generation — the event queue, the open run, run status,
 * pending approvals, the interrupt controller, display mirrors — and two code pointers:
 *
 *   current — the generation whose code processes events (its SessionManager as AgentImpl)
 *   pending — the next generation, attached by its own SessionManager (`setPending`)
 *
 * The pump takes the head event and asks `current` to advance it ONE TURN per call, so
 * every turn boundary is a swap point: between two calls the pointer is replaced, and the
 * next turn of the SAME run is taken by the new code. An open run is adopted, never
 * restarted — its Session object finishes the run it began (the engine's own code is the
 * one thing that must stay put mid-run), while everything around each turn — publishing,
 * recording, approvals, the whole message pipeline — is the new generation's from the
 * first adopted turn on. The loaded Session is marked stale at the swap instead, so the
 * NEXT run reloads through the new generation's loader.
 *
 * Follow-up tasks and background-notice delivery are ordinary queue events — there are no
 * auto-start paths besides the pump. Goals and compactions are immediate activities
 * outside the queue: they have no turn-boundary contract, so a swap hard-aborts them.
 *
 * This class stays small and stable on purpose: policy lives behind `current`, and what
 * is coded here is state, queue discipline and the pointer swap. Its public member list
 * is a declared resource interface (DECLARED_RESOURCES in hmr/platform.ts) — an
 * incompatible successor hard-stops the whole table rather than adopting agents it
 * cannot speak to.
 */
import type { OmniMessage, ThinkingLevelName } from "@prismshadow/penguin-core";
import type { PendingSteeringInfo, SessionStatus } from "../api/types.js";
import { ApprovalRegistry } from "./approvals.js";
import type { RecallStore, RuntimeSession } from "./session-manager.js";
import type { UsageContext } from "./usage-recorder.js";

/** One queued unit of work. */
export type AgentEvent =
  | {
      type: "task";
      /** Recall handle while queued (PendingFollowUpInfo.id). */
      id: string;
      input: OmniMessage[];
      thinkingLevel?: ThinkingLevelName;
      recall?: RecallStore;
      /**
       * Resolved once the run is visibly started (or refused), which is what `startTask`
       * awaits: on return the Task has begun, not merely been accepted.
       */
      started?: () => void;
    }
  /** Deliver queued background completion notices as a task (the session's idle-arrival signal). */
  | { type: "notices" };

/** One undelivered steering entry (display mirror; see SessionManager.pendingSteeringOf). */
export interface PendingSteeringEntry {
  info: PendingSteeringInfo;
  input: OmniMessage[];
  recall: RecallStore;
}

/**
 * The run in progress. Cross-generation state, because a swap adopts it: the successor
 * keeps stepping this Session and closes this run itself. Per-run scratch an adopting
 * generation cannot inherit (stream observers, subagent pairing) lives in `scratch`,
 * which its own code creates and reads.
 */
export interface OpenRun {
  session: RuntimeSession;
  ac: AbortController;
  ctx: UsageContext;
  thinkingLevel: ThinkingLevelName | undefined;
  /** Resolves `agent.running` when the run closes. */
  settle: () => void;
}

/** The code a generation attaches. Only the pump calls it, one call at a time per agent. */
export interface AgentImpl {
  /**
   * Advance the head event by ONE TURN: open the run on the first call for this event,
   * take the next turn otherwise, including a run adopted from another generation.
   * "more" keeps the event for another call;
   * "done" retires it, the run closed and idle published. Guards (shutdown, deletion)
   * are early "done"s; it never throws.
   */
  process(agent: HmrAgent, event: AgentEvent): Promise<"more" | "done">;
}

export class HmrAgent {
  readonly projectId: string;
  readonly agentId: string;
  /** Vendor grouping for the Session's model (paired with modelId to form a model reference). */
  readonly provider: string;
  readonly modelId: string;
  /** Current session id (self-heal rebuilds may replace it — the manager re-keys the table). */
  sessionId: string;

  // —— Cross-generation state, written only by the generation code the pump invokes. ——
  /** Pending work, in order. The event being processed is NOT here — see activeEvent. */
  readonly queue: AgentEvent[] = [];
  /** The event the pump is processing (taken off the queue), or null. */
  activeEvent: AgentEvent | null = null;
  session: RuntimeSession | null = null;
  /** Agent config generation `session` was loaded under; STALE_SESSION after a swap (see the class doc). */
  generation = 0;
  status: SessionStatus = "idle";
  readonly approvals = new ApprovalRegistry();
  abort: AbortController | null = null;
  /** The in-flight activity kind: queue events run as "task"; goals/compactions occupy the slot directly. */
  activeKind: "task" | "goal" | "compact" | null = null;
  /** The run in progress, adopted across a swap (see OpenRun). */
  activeRun: OpenRun | null = null;
  /** The in-flight activity's settle promise (deletion/shutdown/drain await it). */
  running: Promise<void> | null = null;
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
  private submissions: Promise<unknown> = Promise.resolve();

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

  /** Attach the next generation; it takes over at the pump's next turn boundary. */
  setPending(impl: AgentImpl): void {
    this.pending = impl;
    this.pump();
  }

  /** The event loop. Single-flight per agent; every iteration is a swap point. */
  private pump(): void {
    if (this.pumping) return;
    this.pumping = true;
    void (async () => {
      try {
        for (;;) {
          // The swap, in full: the next turn — of this very run, if one is open — is
          // taken by the new code, and the loaded Session is marked stale so the next
          // run reloads through the new loader. A goal/compaction owns the agent and has
          // no boundary, so it is left to the dying generation's quiesce to abort.
          if (
            this.pending !== null &&
            this.activeKind !== "goal" &&
            this.activeKind !== "compact"
          ) {
            this.current = this.pending;
            this.pending = null;
            this.generation = STALE_SESSION;
          }
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

  /** Claim the agent for an immediate activity (goal/compaction); the pump pauses until finishActivity. */
  beginActivity(kind: "goal" | "compact"): void {
    this.activeKind = kind;
  }

  /** Release the immediate-activity claim and let the pump resume queued work. */
  finishActivity(): void {
    this.activeKind = null;
    this.pump();
  }

  /** Interrupt the current activity: approvals converge to deny, then the AbortSignal fires. */
  interrupt(): boolean {
    if (this.abort === null) return false;
    this.approvals.denyAll();
    this.abort.abort();
    return true;
  }

  /**
   * Whether the idle sweep may evict this agent: nothing in flight, nothing queued, and
   * nothing pinned by the live Session — a background process (a dev server the
   * conversation started), a working background subagent, or undelivered completion
   * notices all live in the very object eviction would drop, and the reloaded Session
   * starts with a fresh environment. Eviction is memory reclamation only.
   */
  evictable(now: number, idleMs: number): boolean {
    if (this.status !== "idle" || this.approvals.size !== 0 || this.running !== null) return false;
    if (this.queue.length > 0 || this.activeKind !== null) return false;
    if (this.session?.listBackgroundCommands?.().some((p) => p.running)) return false;
    if (this.session?.hasRunningBackgroundSubagents?.()) return false;
    if (this.session?.hasPendingBackgroundNotices?.()) return false;
    return now - this.lastActivityMs > idleMs;
  }

  /** Releases the loaded Session (killing its background processes) once the in-flight activity settles. */
  disposeWhenSettled(): void {
    const session = this.session;
    const dispose = (): void => session?.dispose?.();
    if (this.running) void this.running.then(dispose, dispose);
    else dispose();
  }
}

/**
 * `generation` value marking the loaded Session as another generation's code. It matches
 * no real config generation, so the manager's ordinary staleness check reloads the
 * Session at the next idle boundary — the same mechanism a vault update uses.
 */
export const STALE_SESSION = -1;
