import type { SessionInfo, SessionStatus } from "@prismshadow/penguin-server/api";
import { isSessionUnread } from "./session-seen";
import type { SessionSeenState } from "./session-seen";

/**
 * Visual state carried by a Session row / chat header. Three states, and `null` for "say
 * nothing at all" — which is the resting state of every row the user has nothing to act on.
 *
 * Background work is a separate facet (see sessionBackgroundTasks), not a fourth state: a
 * Session can be idle, read, and still own a dev server or a background subagent, and a row
 * has to say both at once.
 */
export type SessionActivity = "running" | "compacting" | "completedUnread" | null;

/**
 * The Session's glyph state.
 *
 * Live execution comes from the server (`running` / `compacting` / `idle`). A settled Session
 * only has something to say while its last reply is UNREAD — that read/unread distinction is
 * the client's, because the API models no read receipt (see session-seen.ts). Once read it
 * falls silent: the glyph is a notification, and a list where every finished row carries a
 * permanent marker tells the user nothing about where to look next.
 *
 * `hasTrace` is the server's own "a Task has been started" flag, already on every list row, and
 * it is still load-bearing even though read and never-ran now render identically. Unread is a
 * timestamp comparison against the read marker, and a Session created AFTER this browser first
 * saw the Project has no marker of its own — it falls back to the baseline, and its creation
 * time is later, so it reads as unread. Without this guard every brand-new conversation would
 * wear the "finished, go look" dot before it had ever run.
 */
export function sessionActivity(
  status: SessionStatus,
  hasTrace: boolean,
  unread: boolean,
): SessionActivity {
  // Status first: a live run reports itself even in the window before its Trace is recorded.
  if (status === "running") return "running";
  if (status === "compacting") return "compacting";
  if (!hasTrace) return null;
  return unread ? "completedUnread" : null;
}

/**
 * How many background tasks the Session still owns — command processes running past their
 * yield window plus background subagents mid-round — or 0 when none. The server omits the
 * field entirely at zero and pushes every change on the user channel, so this is live data
 * on the row, not a snapshot from the last list fetch. It is independent of the activity
 * state above: the mark it drives sits beside the glyph, on an idle row as readily as on a
 * running one, and goes away the moment the last task ends.
 */
export function sessionBackgroundTasks(session: Pick<SessionInfo, "backgroundTasks">): number {
  const tasks = session.backgroundTasks;
  return tasks === undefined ? 0 : tasks.processes + tasks.subagents;
}

/** The subset of a row this function needs (a whole SessionInfo satisfies it). */
export type SessionActivityRow = Pick<
  SessionInfo,
  "sessionId" | "status" | "hasTrace" | "lastActiveAt"
>;

/**
 * The glyph one Session ROW draws: `sessionActivity` plus the two things only the list knows —
 * whether the user has looked at this Session since it last ran, and whether it is the
 * conversation currently open.
 *
 * The open conversation is never unread: the user is looking at it. The chat page reaches the
 * same conclusion by stamping the seen marker once a run settles under the user's eyes, but it
 * does so in an effect, one tick after the run-end event moved the row's `lastActiveAt` —
 * deciding it here from what is on screen keeps the glyph from flashing unread for that tick.
 */
export function sessionRowActivity(
  session: SessionActivityRow,
  seen: SessionSeenState,
  activeSessionId: string | null,
): SessionActivity {
  const unread =
    session.sessionId !== activeSessionId &&
    isSessionUnread(seen, session.sessionId, session.lastActiveAt);
  return sessionActivity(session.status, session.hasTrace, unread);
}
