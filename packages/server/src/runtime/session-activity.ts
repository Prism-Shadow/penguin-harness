/**
 * Whether the session runtime may be touching a Session's or an Agent's files right now: what a
 * node that removes such files asks, in the same synchronous step as the removal. Declared apart
 * from the session runtime that answers it (session-manager.ts).
 */
import { Interface } from "@prismshadow/penguin-core/kernel";

/** SessionActivity: the session runtime's in-use answers. */
@Interface()
export abstract class SessionActivity {
  /**
   * A Task or a compaction under way, input queued behind one, a background process or subagent
   * still running, or the Session being deleted. A subagent child runs inside its root's runtime,
   * so it is in use while its root is. A Session that is not loaded is not in use, and nothing
   * loads it without a Task starting through the Session's lock — so a caller that asks this and
   * acts in the same synchronous step cannot be overtaken by a Task.
   */
  abstract sessionInUse(sessionId: string): boolean;
  /**
   * Any Session of the Agent in use — one of its own, or a subagent child of another Agent's
   * Session that runs as this Agent — or the Agent being deleted. What the Agent's shared folders
   * (its tool environments) wait on.
   */
  abstract agentInUse(projectId: string, agentId: string): boolean;
}
