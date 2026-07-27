/**
 * Goal-mode stream helpers, shared by the Session's goal loop and the hosts tapping the
 * stream (the CLI's round lines and summary, the Web server's goal_round / goal_finished
 * SSE events and run-state persistence): token accounting, round boundaries, and the
 * terminal event — all derived from the one message stream `session.run` yields.
 */
import { isEventMessage, isModelMessage } from "../omnimessage/index.js";
import type { GoalOutcomeStatus, OmniMessage } from "../omnimessage/index.js";
import { parseGoalMessage } from "../omnimessage/markers/index.js";

/** How the goal ended plus the loop's own counters (the goal_finished payload, host-shaped). */
export interface GoalOutcome {
  outcome: GoalOutcomeStatus;
  /** Rounds actually run (the wrap-up round counts). */
  rounds: number;
  tokensUsed: number;
}

/**
 * A message's contribution to goal token accounting: uncached input + output of one request
 * (`request.total - request.cache_read`), from any session — origin-marked subagent usage is
 * part of the goal's cost.
 *
 * The sum is a spend ESTIMATE, not a bill: cache reads cost money too, just a small fraction
 * of the uncached-input price, so leaving them out keeps the number an honest approximation
 * without needing per-model price tables. Exported so hosts mirroring the loop's numbers
 * (e.g. the Web server's per-round progress) count exactly the same way.
 */
export function goalTokenDelta(msg: OmniMessage): number {
  if (!isEventMessage(msg) || msg.payload.type !== "token_usage") return 0;
  const { total, cache_read } = msg.payload.request;
  return Math.max(0, total - cache_read);
}

/**
 * Whether this message is a goal round's injected input: the main-session user text carrying
 * the `[goal]` block that the goal loop yields before each round. Hosts use it as the round
 * boundary (the CLI's round line, the Web server's goal_round event).
 */
export function isGoalRoundInput(msg: OmniMessage): boolean {
  if (msg.origin && msg.origin.length > 0) return false;
  if (!isModelMessage(msg) || msg.payload.type !== "text") return false;
  const p = msg.payload as { role?: string; text?: string };
  return p.role === "user" && parseGoalMessage(p.text ?? "") !== null;
}

/**
 * The goal outcome carried by a `goal_finished` event message (the goal loop's final yield),
 * or null for every other message. Hosts read the outcome from the stream with this — there
 * is no generator return value.
 */
export function goalFinishedOf(msg: OmniMessage): GoalOutcome | null {
  if (msg.origin && msg.origin.length > 0) return null;
  if (!isEventMessage(msg) || msg.payload.type !== "goal_finished") return null;
  const p = msg.payload;
  return { outcome: p.outcome, rounds: p.rounds, tokensUsed: p.tokens_used };
}
