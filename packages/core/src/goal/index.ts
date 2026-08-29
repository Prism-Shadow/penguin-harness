/**
 * Goal mode — the public slice: the budget sentinel, the file reader hosts restore their
 * display from, and the stream helpers hosts use to tap a goal-mode `session.run` (round
 * boundaries, the goal hook's progress and outcome). Starting a goal (goal-hook.ts) and the
 * `[goal]` round composition (goal-prompts.ts) are internal to `session.run` and deliberately
 * not part of the SDK surface.
 */
export { readGoalFile, UNLIMITED_BUDGET } from "./goal-file.js";
export type { GoalFile, GoalOutcomeStatus, GoalStatus } from "./goal-file.js";
export { GOAL_HOOK_NAME, goalOutcomeOf, goalProgressOf, isGoalRoundInput } from "./goal-hook.js";
export type { GoalOutcome, GoalProgress } from "./goal-hook.js";
