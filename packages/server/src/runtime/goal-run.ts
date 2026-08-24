/**
 * Goal mode's tap on the run stream: round boundaries (the injected `[goal]` inputs)
 * become goal_round events plus run-state refreshes, and the terminal `goal_finished`
 * message becomes the goal_finished event plus the row's final status. Token numbers
 * mirror core's own accounting (the same `goalTokenDelta`), so the UI shows exactly what
 * the budget check uses.
 *
 * A goal is ONE `session.run(input, { goal })` call looping rounds internally, so it has
 * no turn boundary the event loop can swap at — it is an immediate activity a swap
 * hard-aborts (see SessionManager.quiesce).
 */
import { goalFinishedOf, goalTokenDelta, isGoalRoundInput } from "@prismshadow/penguin-core";
import type { ApproveFn, OmniMessage, ThinkingLevelName } from "@prismshadow/penguin-core";
import type { ServerEvent } from "../api/types.js";
import type { GoalsRepo } from "../db/repos/goals.js";
import type { HmrAgent } from "./hmr-agent.js";
import type { RuntimeSession } from "./session-manager.js";

export interface GoalRunDeps {
  /** Run-state persistence (optional: without it, goals run but leave no restorable record). */
  goals?: GoalsRepo;
  publishEvent: (agent: HmrAgent, event: ServerEvent) => void;
}

export interface GoalRunArgs {
  session: RuntimeSession;
  input: OmniMessage[];
  budget: number;
  thinkingLevel?: ThinkingLevelName;
  approve: ApproveFn;
  signal: AbortSignal;
  goalId?: number;
}

export async function* goalStream(
  deps: GoalRunDeps,
  agent: HmrAgent,
  args: GoalRunArgs,
): AsyncGenerator<OmniMessage> {
  const gen = args.session.run(args.input, {
    approve: args.approve,
    signal: args.signal,
    ...(args.thinkingLevel !== undefined ? { thinkingLevel: args.thinkingLevel } : {}),
    goal: { budget: args.budget },
  });
  let round = 0;
  let used = 0;
  let finished = false;
  /** Closes the row as aborted (a cut-off stream, or an infrastructure failure). */
  const abortRow = (): void => {
    if (args.goalId !== undefined) deps.goals?.finish(args.goalId, "aborted", round, used);
    deps.publishEvent(agent, {
      type: "goal_finished",
      sessionId: agent.sessionId,
      outcome: "aborted",
      rounds: round,
      used,
    });
  };
  try {
    for await (const msg of gen) {
      used += goalTokenDelta(msg);
      if (isGoalRoundInput(msg)) {
        round++;
        if (args.goalId !== undefined) deps.goals?.progress(args.goalId, round, used);
        deps.publishEvent(agent, {
          type: "goal_round",
          sessionId: agent.sessionId,
          round,
          used,
          budget: args.budget,
        });
      }
      const outcome = goalFinishedOf(msg);
      if (outcome) {
        finished = true;
        if (args.goalId !== undefined) {
          deps.goals?.finish(args.goalId, outcome.outcome, outcome.rounds, outcome.tokensUsed);
        }
        deps.publishEvent(agent, {
          type: "goal_finished",
          sessionId: agent.sessionId,
          outcome: outcome.outcome,
          rounds: outcome.rounds,
          used: outcome.tokensUsed,
        });
      }
      yield msg;
    }
    // Defensive: core always ends a goal stream with goal_finished; one that didn't is a
    // cut-off run — close the row so the UI never shows a forever-active goal.
    if (!finished) abortRow();
  } catch (err) {
    // Core throws only on infrastructure failures (e.g. GOAL.yaml writes): close the row,
    // then let the run loop's defensive catch record the error. Guarded on `finished`: a
    // throw after the terminal event must not overwrite the row's real outcome (finish is
    // an unconditional UPDATE) or publish a contradicting event.
    if (!finished) abortRow();
    throw err;
  }
}
