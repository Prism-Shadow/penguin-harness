/**
 * Goal-mode loop driver: repeatedly runs Tasks on one Session until the goal file says stop.
 *
 * `runGoal` wraps multiple `session.run` calls into a single message generator, so hosts drive
 * it exactly like one long Task (the CLI hands it to the renderer, the Web server to the SSE
 * channel) and one AbortSignal covers the whole goal. Each round's injected `<goal_task>` user
 * message is yielded **before** the round runs — `session.run` never yields its own input, and
 * subscribers need the round input on the stream (the Trace is written by the engine as usual).
 *
 * Termination is decided from these sources only:
 * - the goal file's status (`complete` / `blocked`, written by the model; parse failures
 *   normalize to `blocked` — see goal-file.ts),
 * - the runner's own token accounting against the budget (the file's tokens block is
 *   display-only and never read back),
 * - a round the engine cut off rather than finished — a main-session abort (LLM failure,
 *   user interrupt) or a final assistant notice with `stop_reason: "failed"` (the engine's
 *   max_turns cutoff emits exactly that, and no abort event): the model never got to write
 *   the file, so re-firing would loop the same cutoff forever, and
 * - a hard round cap (`maxRounds`, default 100) as a runaway backstop independent of the
 *   budget — without it an unbudgeted goal whose model simply never writes the file would
 *   loop without bound.
 * All of these stop the loop without re-firing: the goal stays `active` on disk and the
 * file is left untouched (the workspace and goal file are the resume point).
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
  /** Installed skill names applied every regular round (host-validated; see GoalPromptArgs). */
  skills?: string[];
  /**
   * Hard cap on rounds (wrap-up included), a runaway backstop independent of the budget.
   * Default 100 — far above any legitimate goal (each round is a full Task), so hosts don't
   * expose it as a knob.
   */
  maxRounds?: number;
  signal?: AbortSignal;
  approve?: RunOptions["approve"];
}

/** Default `maxRounds`: the runaway backstop for goals with no (or a huge) budget. */
export const GOAL_MAX_ROUNDS = 100;

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

/**
 * The main session's assistant text, or null. Used to track how a round ended: the engine's
 * max_turns cutoff finishes the stream with an assistant notice carrying
 * `stop_reason: "failed"` (and no abort event) — the only failure mode that neither
 * `isMainAbort` nor the goal file can see.
 */
function mainAssistantStopReason(msg: OmniMessage): string | null {
  if (msg.origin && msg.origin.length > 0) return null;
  if (!isModelMessage(msg) || msg.payload.type !== "text") return null;
  const p = msg.payload as { role?: string; stop_reason?: string };
  return p.role === "assistant" ? (p.stop_reason ?? "completed") : null;
}

export async function* runGoal(
  session: GoalSession,
  opts: RunGoalOptions,
): AsyncGenerator<OmniMessage, GoalOutcome> {
  const budget = opts.budget ?? UNLIMITED_BUDGET;
  const maxRounds = opts.maxRounds ?? GOAL_MAX_ROUNDS;
  const runOpts: RunOptions = {
    ...(opts.signal ? { signal: opts.signal } : {}),
    ...(opts.approve ? { approve: opts.approve } : {}),
  };
  let used = 0;
  let rounds = 0;
  let aborted = false;
  let roundFailed = false;

  /** Runs one round: yields the injected input, then the Task's stream, accounting as it goes. */
  async function* round(text: string): AsyncGenerator<OmniMessage> {
    rounds++;
    roundFailed = false;
    const input = userText(text);
    yield input;
    for await (const msg of session.run([input], runOpts)) {
      used += goalTokenDelta(msg);
      if (isMainAbort(msg)) aborted = true;
      // The LAST assistant text decides: a mid-round failed notice followed by normal text
      // means the round recovered; the max_turns cutoff is always the final message.
      const stop = mainAssistantStopReason(msg);
      if (stop !== null) roundFailed = stop === "failed";
      yield msg;
    }
  }

  await writeGoalFile(opts.goalFilePath, {
    objective: opts.objective,
    status: "active",
    tokens: { budget, used },
  });

  for (;;) {
    // An abort landing BETWEEN rounds produces no abort event on any stream — without this
    // check the loop would fire a phantom round whose <goal_task> input the already-aborted
    // engine holds as carry-over, leaking the block into the user's next message.
    if (opts.signal?.aborted) return { outcome: "aborted", rounds, tokensUsed: used };
    // Runaway backstop, independent of the budget (which may be unlimited).
    if (rounds >= maxRounds) return { outcome: "aborted", rounds, tokensUsed: used };
    yield* round(
      goalTaskMessage({
        objective: opts.objective,
        goalFilePath: opts.goalFilePath,
        round: rounds + 1,
        tokensUsed: used,
        budget,
        ...(opts.skills !== undefined ? { skills: opts.skills } : {}),
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
    // A round the engine cut off (final assistant notice with stop_reason "failed" — the
    // max_turns path) is terminal, not a reason to re-fire: the model never reached the
    // file, and the next round would hit the same cutoff. A written terminal status above
    // still wins (a post-completion cutoff doesn't undo the completion).
    if (roundFailed) return { outcome: "aborted", rounds, tokensUsed: used };

    if (budget > 0 && used >= budget) {
      // Same phantom-round guard as at the loop top, for the wrap-up round.
      if (opts.signal?.aborted) return { outcome: "aborted", rounds, tokensUsed: used };
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
