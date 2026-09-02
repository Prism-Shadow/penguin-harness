/**
 * SubagentSessionManager —— registry and lifecycle management for background subagent sessions.
 *
 * Constructed by Environment (one per Session), injected via services to be shared by the
 * `run_subagent` and `input_subagent` tools. Registry duties are handled by the generic
 * `BackgroundRegistry` (shared with command sessions, see `../background/registry.ts`).
 * Difference from command sessions: when at capacity, **running sessions are never evicted**
 * (discarding in-progress subagent work is unacceptable) — only completed, idle ones are
 * evicted; if there's still no room, the tool rejects spawning a new one.
 * Docs: /docs/tools § "Background session caps".
 */
import type { ApproveFn, BackgroundSubagentInfo } from "../../../interfaces/index.js";
import { BackgroundRegistry } from "../background/index.js";
import type { ManagedSubagentSession } from "./session.js";

/**
 * Cap on concurrently managed background subagent sessions. This is a **spawn admission cap**,
 * not a hard limit: there's an await between the `makeRoom` check (before spawn) and `register`
 * (after the yield window ends), so parallel run_subagent calls can briefly push the registered
 * count over the cap — an already-running child session is never discarded just to hold the line.
 */
const MAX_SESSIONS = 8;

export class SubagentSessionManager {
  private readonly registry = new BackgroundRegistry<ManagedSubagentSession>({
    idPrefix: "subagent",
    maxTasks: MAX_SESSIONS,
  });
  /**
   * Live index by child Session id: EVERY spawned session, tracked from spawn — children
   * still inside a foreground collect window included, so host paths (the subagents panel)
   * can steer or abort them before any `subagent_id` exists. Dead entries drop lazily on
   * access; `subagent_id` is still allocated only at background registration.
   */
  private readonly live = new Set<ManagedSubagentSession>();
  /** Single aggregate run-state listener (the Environment's notifier); pinged on any child's run start/settle. */
  private stateListener: (() => void) | null = null;
  /** Host fallback approval sink, applied to every tracked session (see EnvironmentInterface.setSubagentApprovalFallback). */
  private approvalFallback: ApproveFn | null = null;
  /** Single registry-membership listener (see onChange); null until the Environment subscribes. */
  private changeListener: (() => void) | null = null;

  constructor() {
    this.registry.onChange(() => this.changeListener?.());
  }

  /**
   * Attaches the single listener for registry membership changes — a session promoted to
   * the background (register) or released from it (eviction, idle reap, dispose). Round
   * start/settle rides the separate run-state listener (setStateListener). Payload-free;
   * subscribers re-read `listLive()`. A later call replaces the earlier one.
   */
  onChange(listener: () => void): void {
    this.changeListener = listener;
  }

  /** Whether the manager has been disposed (the host Session has ended). */
  get isDisposed(): boolean {
    return this.registry.isDisposed;
  }

  /** Enters a freshly spawned session into the live index and wires its run-state pings into the aggregate listener. */
  track(session: ManagedSubagentSession): void {
    this.live.add(session);
    session.onStateChange(() => this.stateListener?.());
    if (this.approvalFallback) session.setFallbackApprovalSink(this.approvalFallback);
  }

  /** Attaches the host fallback approval sink, applying it to already-tracked live sessions too. */
  setApprovalFallback(approve: ApproveFn): void {
    this.approvalFallback = approve;
    for (const session of [...this.live]) {
      if (session.disposed) {
        this.live.delete(session);
        continue;
      }
      session.setFallbackApprovalSink(approve);
    }
  }

  /** Attaches the single aggregate run-state listener (see track). */
  setStateListener(listener: () => void): void {
    this.stateListener = listener;
  }

  /** Looks up a live session by its child Session id (foreground-window ones included); undefined when none. */
  bySessionId(sessionId: string): ManagedSubagentSession | undefined {
    let found: ManagedSubagentSession | undefined;
    for (const session of [...this.live]) {
      if (session.disposed) {
        this.live.delete(session);
        continue;
      }
      if (session.sessionId === sessionId) found = session;
    }
    return found;
  }

  /** All live child sessions for a host UI (see BackgroundSubagentInfo); registry handles resolve where the session was promoted. */
  listLive(): BackgroundSubagentInfo[] {
    const handles = new Map<ManagedSubagentSession, string>();
    for (const { id, task } of this.registry.list()) handles.set(task, id);
    const out: BackgroundSubagentInfo[] = [];
    for (const session of [...this.live]) {
      if (session.disposed) {
        this.live.delete(session);
        continue;
      }
      out.push({
        sessionId: session.sessionId,
        subagentId: handles.get(session) ?? null,
        running: session.running,
      });
    }
    return out;
  }

  /** Whether there's still room for a new background session (evicting a completed, idle one if needed; never evicts a running one). */
  makeRoom(): boolean {
    return this.registry.makeRoom(false);
  }

  /**
   * Whether any managed subagent session is mid-round. Hosts use it the same way they use a
   * running background command: a child that outlives the call which launched it must keep
   * its Session's runtime entry alive, or its completion report and live messages land on an
   * object nobody holds any more.
   */
  hasRunning(): boolean {
    return this.registry.list().some(({ task }) => task.running);
  }

  /**
   * Registers a still-running session as a background session, allocating and returning a
   * unique `subagent_id`: `subagent-<last 8 hex of child Session id>` (falls back to random on
   * collision), whose suffix aligns with the message origin/frontend nesting label
   * (`agent-<last 3 chars>`) for correlation.
   */
  register(session: ManagedSubagentSession): string {
    // A full yield window has elapsed since the pre-spawn makeRoom check, so the registry may
    // have been filled by parallel calls in the meantime: free up room once more (only evicting
    // completed, idle ones); if still no room, register anyway, tolerating a brief overshoot
    // (see MAX_SESSIONS).
    this.registry.makeRoom(false);
    const id = this.registry.register(session, session.sessionId.slice(-8));
    // Tombstone for the revival path: a subagent session is never destroyed the way a process
    // is — releasing it (idle eviction) only frees the slot, and this record lets a later
    // input_subagent on the same id resume the child instead of erroring. Parent-session
    // lifetime, one small record per registration.
    this.registered.set(id, {
      sessionId: session.sessionId,
      ...(session.resumeAgentId !== undefined ? { agentId: session.resumeAgentId } : {}),
    });
    return id;
  }

  /** Ever-registered index by subagent_id (see register): the resume clue for ids whose session left the registry. */
  private readonly registered = new Map<string, { sessionId: string; agentId?: string }>();

  /** The resume clue for a subagent_id no longer in the registry; undefined for ids this parent session never allocated. */
  releasedInfo(subagentId: string): { sessionId: string; agentId?: string } | undefined {
    return this.registered.get(subagentId);
  }

  /** Looks up a session by subagent_id and refreshes its access time; returns undefined if not found. */
  get(subagentId: string): ManagedSubagentSession | undefined {
    return this.registry.get(subagentId);
  }

  /** Disposes: removes the fallback registration and finalizes all sessions (the process 'exit' fallback is hooked by the registry itself). Idempotent. */
  dispose(): void {
    this.registry.dispose();
  }
}
