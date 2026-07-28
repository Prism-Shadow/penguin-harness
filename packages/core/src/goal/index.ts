/**
 * Goal mode — the public slice: the budget sentinel and the stream helpers hosts use to tap
 * a goal-mode `session.run` (round boundaries, token accounting, the terminal outcome).
 * Everything else — the GOAL.yaml protocol (goal-file.ts), the `[goal]` round composition
 * (goal-prompts.ts), and the loop itself (goal-loop.ts) — is internal to `session.run` and
 * deliberately not part of the SDK surface.
 */
export { UNLIMITED_BUDGET } from "./goal-file.js";
export { goalFinishedOf, goalTokenDelta, isGoalRoundInput } from "./goal-stream.js";
export type { GoalOutcome } from "./goal-stream.js";
