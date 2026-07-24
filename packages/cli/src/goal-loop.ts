/**
 * Consumption loop that drives goal mode to completion (CLI side, shared by run and chat).
 *
 * Wraps core's `runGoal` the way task-loop wraps `session.run`: the CLI supplies the same
 * approval callback (goal rounds approve exactly like regular Tasks) and consumes one message
 * stream for the whole goal — a single AbortSignal (Ctrl-C) therefore stops the entire loop,
 * never just the current round.
 *
 * Round boundaries are the injected `<goal_task>` user messages runGoal yields before each
 * round. The renderer never prints complete model_msg (the block would flood the terminal), so
 * this loop prints its own dim round line and settles per-round stats via `endTask` at each
 * boundary, matching the per-Task stats rhythm of a normal chat.
 */
import { isGoalRoundInput, runGoal } from "@prismshadow/penguin-core";
import type { GoalOutcome, Session } from "@prismshadow/penguin-core";
import { dim, humanizeTokens } from "./render.js";
import { buildApprove, type RunTaskOptions } from "./task-loop.js";

export async function runGoalLoop(
  session: Session,
  goal: { objective: string; goalFilePath: string; budget: number },
  opts: RunTaskOptions & { out: NodeJS.WritableStream },
): Promise<GoalOutcome> {
  const approve = buildApprove(session, opts);
  const gen = runGoal(session, {
    objective: goal.objective,
    goalFilePath: goal.goalFilePath,
    budget: goal.budget,
    approve,
    ...(opts.signal ? { signal: opts.signal } : {}),
  });

  let round = 0;
  let roundStartedAt: number | null = null;
  let outcome: GoalOutcome;
  try {
    for (;;) {
      const next = await gen.next();
      if (next.done) {
        outcome = next.value;
        break;
      }
      const msg = next.value;
      if (isGoalRoundInput(msg)) {
        // Settle the previous round's stats before announcing the next (endTask is what
        // prints the per-task `[stats]` line in a normal chat).
        if (roundStartedAt !== null) opts.renderer.endTask(Date.now() - roundStartedAt);
        round++;
        roundStartedAt = Date.now();
        opts.out.write(`${dim(opts.t.goalRound(round))}\n`);
      }
      opts.renderer.handle(msg);
    }
  } finally {
    if (roundStartedAt !== null) opts.renderer.endTask(Date.now() - roundStartedAt);
  }
  opts.out.write(
    `${dim(opts.t.goalFinished(outcome.outcome, outcome.rounds, humanizeTokens(outcome.tokensUsed)))}\n`,
  );
  return outcome;
}
