/** Goal mode: the GOAL.yaml control-file protocol, prompt composition, and stream helpers (the loop itself lives behind `session.run`). */
export { UNLIMITED_BUDGET, readGoalStatus, serializeGoalFile, writeGoalFile } from "./goal-file.js";
export type { GoalFile, GoalStatus } from "./goal-file.js";
export { goalRoundMessage, goalWrapUpMessage } from "./goal-prompts.js";
export type { GoalPromptArgs } from "./goal-prompts.js";
export { goalFinishedOf, goalTokenDelta, isGoalRoundInput } from "./goal-stream.js";
export type { GoalOutcome } from "./goal-stream.js";
export { GOAL_MAX_ROUNDS } from "./goal-loop.js";
