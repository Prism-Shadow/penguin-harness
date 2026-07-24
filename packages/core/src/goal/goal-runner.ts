/**
 * Goal-mode loop driver: repeatedly runs Tasks on one Session until the goal file says stop.
 *
 * `runGoal` wraps multiple `session.run` calls into a single message generator, so hosts drive
 * it exactly like one long Task (the CLI hands it to the renderer, the Web server to the SSE
 * channel) and one AbortSignal covers the whole goal. Each round's injected `<goal_task>` user
 * message is yielded **before** the round runs — `session.run` never yields its own input, and
 * subscribers need the round input on the stream (the Trace is written by the engine as usual).
 *
 * Termination is decided from two sources only:
 * - the goal file's status (`complete` / `blocked`, written by the model; parse failures
 *   normalize to `blocked` — see goal-file.ts), and
 * - the runner's own token accounting against the budget (the file's tokens block is
 *   display-only and never read back).
 * A round that ends with a main-session abort (LLM failure, user interrupt) stops the loop
 * without re-firing: the goal stays `active` on disk and the file is left untouched.
 *
 * Token accounting is incremental, "uncached input + output": every `token_usage` event on the
 * stream — including origin-marked ones from subagent sessions, which are part of the goal's
 * cost — contributes `request.total - request.cache_read`.
 */
import { isEventMessage, isModelMessage, userText } from "../omnimessage/index.js";
import type { OmniMessage } from "../omnimessage/index.js";
import type { RunOptions } from "../engine/context-engine.js";
import { readGoalStatus, writeGoalFile, UNLIMITED_BUDGET } from "./goal-file.js";
import { budgetLimitMessage, goalTaskMessage } from "./goal-prompts.js";

/** The slice of Session that runGoal drives (structural, so tests can substitute a fake). */
export interface GoalSession {
  run(newMessages: OmniMessage[], opts?: RunOptions): AsyncGenerator<OmniMessage>;
}

export interface RunGoalOptions {
  objective: string;
  /** Absolute path of GOAL.yaml (see `goalFilePath` in state/paths.ts). */
  goalFilePath: string;
  /** Token budget; omitted or `UNLIMITED_BUDGET` (-1) means no budget. */
  budget?: number;
  signal?: AbortSignal;
  approve?: RunOptions["approve"];
}

/** How the goal ended: the file's terminal status, or `aborted` when a round was interrupted. */
export type GoalOutcomeStatus = "complete" | "blocked" | "budget_limited" | "aborted";

/** Returned by the `runGoal` generator; hosts report it (CLI summary line, server event/state). */
export interface GoalOutcome {
  outcome: GoalOutcomeStatus;
  /** Rounds actually run (the wrap-up round counts). */
  rounds: number;
  tokensUsed: number;
}

/**
 * A message's contribution to goal token accounting: uncached input + output of one request
 * (`request.total - request.cache_read`), from any session — origin-marked subagent usage is
 * part of the goal's cost. Exported so hosts mirroring the runner's numbers (e.g. the Web
 * server's per-round progress) count exactly the same way.
 */
export function goalTokenDelta(msg: OmniMessage): number {
  if (!isEventMessage(msg) || msg.payload.type !== "token_usage") return 0;
  const { total, cache_read } = msg.payload.request;
  return Math.max(0, total - cache_read);
}

/**
 * Whether this message is a goal round's injected input: the main-session user text carrying
 * the `<goal_task>` block that `runGoal` yields before each round. Hosts use it as the round
 * boundary (the CLI's round line, the Web server's goal_round event).
 */
export function isGoalRoundInput(msg: OmniMessage): boolean {
  if (msg.origin && msg.origin.length > 0) return false;
  if (!isModelMessage(msg) || msg.payload.type !== "text") return false;
  const p = msg.payload as { role?: string; text?: string };
  return p.role === "user" && (p.text ?? "").startsWith("<goal_task>");
}

/** Whether this message is the **main** session's abort event (subagent aborts don't end the goal). */
function isMainAbort(msg: OmniMessage): boolean {
  return isEventMessage(msg) && msg.payload.type === "abort" && (msg.origin?.length ?? 0) === 0;
}

export async function* runGoal(
  session: GoalSession,
  opts: RunGoalOptions,
): AsyncGenerator<OmniMessage, GoalOutcome> {
  const budget = opts.budget ?? UNLIMITED_BUDGET;
  const runOpts: RunOptions = {
    ...(opts.signal ? { signal: opts.signal } : {}),
    ...(opts.approve ? { approve: opts.approve } : {}),
  };
  let used = 0;
  let rounds = 0;
  let aborted = false;

  /** Runs one round: yields the injected input, then the Task's stream, accounting as it goes. */
  async function* round(text: string): AsyncGenerator<OmniMessage> {
    rounds++;
    const input = userText(text);
    yield input;
    for await (const msg of session.run([input], runOpts)) {
      used += goalTokenDelta(msg);
      if (isMainAbort(msg)) aborted = true;
      yield msg;
    }
  }

  await writeGoalFile(opts.goalFilePath, {
    objective: opts.objective,
    status: "active",
    tokens: { budget, used },
  });

  for (;;) {
    yield* round(
      goalTaskMessage({
        objective: opts.objective,
        goalFilePath: opts.goalFilePath,
        round: rounds + 1,
        tokensUsed: used,
        budget,
      }),
    );
    // Abort wins over whatever is in the file: the goal stays active on disk (the workspace
    // and goal file are the resume point) and nothing is rewritten mid-interrupt.
    if (aborted) return { outcome: "aborted", rounds, tokensUsed: used };

    const status = await readGoalStatus(opts.goalFilePath);
    if (status !== "active") {
      await writeGoalFile(opts.goalFilePath, {
        objective: opts.objective,
        status,
        tokens: { budget, used },
      });
      return { outcome: status, rounds, tokensUsed: used };
    }

    if (budget > 0 && used >= budget) {
      // One wrap-up round, then the system-side terminal state — unless the model could
      // truthfully complete during wrap-up (its template forbids a courtesy `complete`).
      yield* round(
        budgetLimitMessage({
          objective: opts.objective,
          goalFilePath: opts.goalFilePath,
          round: rounds + 1,
          tokensUsed: used,
          budget,
        }),
      );
      if (aborted) return { outcome: "aborted", rounds, tokensUsed: used };
      const wrapStatus = await readGoalStatus(opts.goalFilePath);
      const finalStatus = wrapStatus === "complete" ? "complete" : "budget_limited";
      await writeGoalFile(opts.goalFilePath, {
        objective: opts.objective,
        status: finalStatus,
        tokens: { budget, used },
      });
      return { outcome: finalStatus, rounds, tokensUsed: used };
    }

    // Next round: refresh the display-only tokens block so the model sees current numbers.
    await writeGoalFile(opts.goalFilePath, {
      objective: opts.objective,
      status: "active",
      tokens: { budget, used },
    });
  }
}
