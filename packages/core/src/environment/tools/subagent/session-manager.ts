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
import { BackgroundRegistry } from "../background/index.js";
import type { ManagedSubagentSession } from "./session.js";
import type {
  ApproveFn,
  BackgroundSubagentInfo,
  SubagentMessageResult,
} from "../../../interfaces.js";

/**
 * Cap on concurrently retained subagent sessions. This is a **spawn admission cap**, not a hard
 * limit: there's an await between the `makeRoom` check and child creation, so parallel
 * run_subagent calls can briefly push the registered count over the cap — an already-running
 * child session is never discarded just to hold the line.
 */
const MAX_SESSIONS = 8;

export class SubagentSessionManager {
  private readonly registry = new BackgroundRegistry<ManagedSubagentSession>({
    idPrefix: "subagent",
    maxTasks: MAX_SESSIONS,
  });
  private defaultApprove: ApproveFn | null = null;
  private eventSink: {
    message: (message: import("../../../omnimessage/index.js").OmniMessage) => void;
    change: () => void;
  } | null = null;

  /** Whether the manager has been disposed (the host Session has ended). */
  get isDisposed(): boolean {
    return this.registry.isDisposed;
  }

  /** Whether there's still room for a new retained child (evicting a completed, idle one if needed; never evicts a running one). */
  makeRoom(): boolean {
    return this.registry.makeRoom(false);
  }

  /**
   * Registers a child immediately after spawn, allocating and returning a unique `subagent_id`:
   * `subagent-<last 8 hex of child Session id>` (falls back to random on collision), whose suffix
   * aligns with the message origin/frontend nesting label (`agent-<last 3 chars>`) for correlation.
   */
  register(session: ManagedSubagentSession): string {
    // Spawning awaited child creation after the admission check, so the registry may have been
    // filled by parallel calls in the meantime: free up room once more (only evicting completed,
    // idle ones); if still no room, register anyway, tolerating a brief overshoot (see
    // MAX_SESSIONS).
    this.registry.makeRoom(false);
    session.setDefaultApprovalSink(this.defaultApprove);
    session.setEventSink(this.eventSink);
    return this.registry.register(session, session.sessionId.slice(-8));
  }

  /** Looks up a session by subagent_id and refreshes its access time; returns undefined if not found. */
  get(subagentId: string): ManagedSubagentSession | undefined {
    return this.registry.get(subagentId);
  }

  /** Looks up by the stable child Session id used by message origins/the Web UI. */
  getBySessionId(sessionId: string): ManagedSubagentSession | undefined {
    const found = this.registry.list().find(({ task }) => task.sessionId === sessionId);
    return found ? this.registry.get(found.id) : undefined;
  }

  list(): BackgroundSubagentInfo[] {
    return this.registry.list().map(({ task }) => ({
      sessionId: task.sessionId,
      status: task.stopping ? "stopping" : task.running ? "running" : "idle",
      startedAt: task.startedAt,
      endedAt: task.endedAt,
    }));
  }

  sendMessage(sessionId: string, prompt: string): SubagentMessageResult {
    const session = this.getBySessionId(sessionId);
    if (!session) return "not_found";
    if (session.stopping) return "stopping";
    if (session.running) return session.steer(prompt) ? "steered" : "not_running";
    try {
      session.startRun(prompt);
      return "started";
    } catch {
      return "not_running";
    }
  }

  interrupt(sessionId: string): boolean {
    return this.getBySessionId(sessionId)?.interruptRun() ?? false;
  }

  interruptAll(): number {
    let interrupted = 0;
    for (const { task } of this.registry.list()) {
      if (task.interruptRun()) interrupted += 1;
    }
    return interrupted;
  }

  setApprovalSink(approve: ApproveFn | null): void {
    this.defaultApprove = approve;
    for (const { task } of this.registry.list()) task.setDefaultApprovalSink(approve);
  }

  setEventSink(
    sink: {
      message: (message: import("../../../omnimessage/index.js").OmniMessage) => void;
      change: () => void;
    } | null,
  ): void {
    this.eventSink = sink;
    for (const { task } of this.registry.list()) task.setEventSink(sink);
  }

  /** Disposes: removes the fallback registration and finalizes all sessions (the process 'exit' fallback is hooked by the registry itself). Idempotent. */
  dispose(): void {
    this.registry.dispose();
  }
}
