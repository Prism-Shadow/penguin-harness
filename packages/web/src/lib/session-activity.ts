import type { SessionStatus } from "@prismshadow/penguin-server/api";

/** Visual status carried by a Session row / chat header. `null` keeps settled, seen Sessions quiet. */
export type SessionActivity = "running" | "compacting" | "completed" | null;

/**
 * The server owns live execution (`running` / `compacting` / `idle`); the client adds one
 * deliberately transient state: a completion observed in this app lifetime and not dismissed
 * by opening the Session again. Idle alone must not render as completed — that would mark every
 * historical conversation after a reload.
 */
export function sessionActivity(
  status: SessionStatus,
  recentlyCompleted: boolean,
): SessionActivity {
  if (status === "running") return "running";
  if (status === "compacting") return "compacting";
  return recentlyCompleted ? "completed" : null;
}

/**
 * Fold a live status transition into the transient completion-highlight set.
 *
 * - beginning a new active run clears the old highlight;
 * - active → idle records a completion;
 * - idle snapshots and no-op observations do nothing, so loading history never invents a dot.
 *
 * Same-reference no-ops keep React state updates cheap and make the behavior straightforward to
 * unit test.
 */
export function advanceCompletionHighlights(
  current: ReadonlySet<string>,
  sessionId: string,
  previous: SessionStatus,
  next: SessionStatus,
): ReadonlySet<string> {
  if (next === "running" || next === "compacting") {
    if (!current.has(sessionId)) return current;
    const updated = new Set(current);
    updated.delete(sessionId);
    return updated;
  }
  if (previous !== "idle" && next === "idle") {
    if (current.has(sessionId)) return current;
    return new Set(current).add(sessionId);
  }
  return current;
}

/** Dismiss one observed completion when its Session row is opened again. */
export function dismissCompletionHighlight(
  current: ReadonlySet<string>,
  sessionId: string,
): ReadonlySet<string> {
  if (!current.has(sessionId)) return current;
  const updated = new Set(current);
  updated.delete(sessionId);
  return updated;
}
