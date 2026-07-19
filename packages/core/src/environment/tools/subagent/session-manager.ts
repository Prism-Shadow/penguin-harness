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

  /** Whether the manager has been disposed (the host Session has ended). */
  get isDisposed(): boolean {
    return this.registry.isDisposed;
  }

  /** Whether there's still room for a new background session (evicting a completed, idle one if needed; never evicts a running one). */
  makeRoom(): boolean {
    return this.registry.makeRoom(false);
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
    return this.registry.register(session, session.sessionId.slice(-8));
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
