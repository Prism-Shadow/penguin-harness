/** Goal mode: the GOAL.yaml control-file protocol, injected prompt blocks, and the loop driver. */
export { UNLIMITED_BUDGET, readGoalStatus, writeGoalFile } from "./goal-file.js";
export type { GoalFile, GoalStatus } from "./goal-file.js";
export { budgetLimitMessage, goalTaskMessage } from "./goal-prompts.js";
export type { GoalPromptArgs } from "./goal-prompts.js";
export { goalTokenDelta, isGoalRoundInput, runGoal } from "./goal-runner.js";
export type { GoalOutcome, GoalOutcomeStatus, GoalSession, RunGoalOptions } from "./goal-runner.js";
