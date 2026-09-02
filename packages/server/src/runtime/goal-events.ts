/**
 * The goal plugin's stop hook answers, read off the message stream: every answer is a `hook`
 * event named `goal` whose `output` carries the goal file's state (status, round, tokens_used,
 * budget). The manager maps them to goal_round / goal_finished server events; the CLI reads
 * those server events rather than the hook events, so this is the only place the plugin's
 * record shape is interpreted. Round boundaries are core's `isHookInput`.
 */
import { isEventMessage } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";

/** The name the goal plugin's hook package answers under. */
const GOAL_HOOK_NAME = "goal";

/** The four ways a goal ends: the two the model may claim, and the two the hook decides. */
const GOAL_OUTCOMES = ["complete", "blocked", "budget_limited", "aborted"] as const;
export type GoalOutcomeStatus = (typeof GOAL_OUTCOMES)[number];

export function isGoalOutcome(status: string): status is GoalOutcomeStatus {
  return (GOAL_OUTCOMES as readonly string[]).includes(status);
}

/** What a goal hook event records: the file's state after the decision. */
export interface GoalProgress {
  decision: "continue" | "stop";
  status: string;
  round: number;
  tokensUsed: number;
}

/** The goal hook's record carried by a main-session `hook` event, or null for any other message. */
export function goalProgressOf(msg: OmniMessage): GoalProgress | null {
  if (msg.origin && msg.origin.length > 0) return null;
  if (!isEventMessage(msg) || msg.payload.type !== "hook") return null;
  const p = msg.payload;
  if (p.name !== GOAL_HOOK_NAME || !p.output) return null;
  // The goal plugin's stop hook only ever answers continue/stop; other decision values
  // belong to other hook points and are no goal record.
  if (p.decision !== "continue" && p.decision !== "stop") return null;
  const o = p.output;
  return {
    decision: p.decision,
    status: String(o.status ?? ""),
    round: Number(o.round ?? 0),
    tokensUsed: Number(o.tokens_used ?? 0),
  };
}

/** How a goal ended plus its counters, from the goal hook's `stop` event; null for every other message. */
export function goalOutcomeOf(
  msg: OmniMessage,
): { outcome: GoalOutcomeStatus; rounds: number; tokensUsed: number } | null {
  const p = goalProgressOf(msg);
  if (!p || p.decision !== "stop" || !isGoalOutcome(p.status)) return null;
  return { outcome: p.status, rounds: p.round, tokensUsed: p.tokensUsed };
}
