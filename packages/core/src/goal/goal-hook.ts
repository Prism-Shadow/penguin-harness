/**
 * Goal mode as a stop hook. `startGoal` writes GOAL.yaml, composes the round-1 message and
 * hands back the hook that `Session.run` consults after every Task of that run: the hook
 * reads the file's status, decides `continue` (with the next round's `[goal]` message as
 * its input) or `stop`, and writes the file back with `round` / `tokens_used` refreshed and
 * `status` set to what it decided. There is no loop of its own — the Session's generic
 * hook loop drives the rounds — and no dedicated message type: the goal's end is the
 * hook's `stop` event, whose `output` carries the outcome and the counters
 * (`goalOutcomeOf` reads it back for hosts).
 *
 * The decision, first match wins:
 * - the file says `complete` / `blocked` (or cannot be read) → stop with that outcome;
 * - the Task was cut off (abort, LLM failure, the max_turns cap — the model never got to
 *   write the file, and re-firing would hit the same cutoff again) → `aborted`;
 * - the wrap-up round just ran → `budget_limited`;
 * - the round cap (GOAL_MAX_ROUNDS, a runaway backstop for goals with no or a huge
 *   budget) → `aborted`;
 * - the budget is reached → one wrap-up round (`wrapping_up`);
 * - otherwise → the next round.
 * The counters are the run's own: `round` is the hook input's Task count, `tokens_used`
 * its uncached input + output (subagent sessions included).
 */
import { userText } from "../omnimessage/index.js";
import type { HookPayload, OmniMessage } from "../omnimessage/index.js";
import { isEventMessage, isModelMessage } from "../omnimessage/index.js";
import { parseGoalMessage, stripLeadingMarkerBlocks } from "../omnimessage/markers/index.js";
import type { StopHook, StopHookInput, StopHookResult } from "../hooks/stop-hook.js";
import { isGoalOutcome, readGoalFile, UNLIMITED_BUDGET, writeGoalFile } from "./goal-file.js";
import type { GoalFile, GoalOutcomeStatus } from "./goal-file.js";
import { goalRoundMessage, goalWrapUpMessage } from "./goal-prompts.js";

/** The goal hook's name: what its `hook` events carry as `name`. */
export const GOAL_HOOK_NAME = "goal";

/**
 * Hard cap on rounds, a runaway backstop independent of the budget: without it an unbudgeted
 * goal whose model simply never writes the file would loop without bound. Far above any
 * legitimate goal (each round is a full Task), so hosts don't expose it as a knob.
 */
export const GOAL_MAX_ROUNDS = 100;

export interface StartGoalOptions {
  /**
   * The round-1 message body: the caller's input text verbatim (skill-invocation blocks and
   * all). The objective — re-injected as later rounds' body and recorded in GOAL.yaml — is
   * this text with leading marker blocks stripped.
   */
  text: string;
  /** Absolute path of GOAL.yaml (see `goalFilePath` in state/paths.ts). */
  goalFilePath: string;
  /** Token budget; omitted or `UNLIMITED_BUDGET` (-1) means no budget. */
  budget?: number;
}

export interface StartedGoal {
  /** The round-1 user message (the `[goal]` block followed by the caller's text). */
  input: OmniMessage;
  /** The stop hook driving every later round of this run. */
  hook: StopHook;
}

/** Writes the goal file and builds the round-1 input and the hook (see the module header). */
export async function startGoal(opts: StartGoalOptions): Promise<StartedGoal> {
  const stripped = stripLeadingMarkerBlocks(opts.text).trim();
  const objective = stripped || opts.text.trim();
  const budget = opts.budget ?? UNLIMITED_BUDGET;
  const first: GoalFile = { objective, status: "active", budget, round: 1, tokens_used: 0 };
  await writeGoalFile(opts.goalFilePath, first);
  const input = userText(
    goalRoundMessage({ goal: first, goalFilePath: opts.goalFilePath, body: opts.text }),
  );

  const record = (goal: GoalFile): HookPayload["output"] => ({
    status: goal.status,
    round: goal.round,
    tokens_used: goal.tokens_used,
    budget: goal.budget,
  });
  const tokens = (goal: GoalFile): string =>
    `tokens ${goal.tokens_used}${goal.budget > 0 ? ` / ${goal.budget}` : ""}`;

  const decide = async (input: StopHookInput): Promise<StopHookResult> => {
    const file = await readGoalFile(opts.goalFilePath);
    // The system's own values are re-asserted on every write: the model owns `status` only.
    const goal: GoalFile = {
      objective,
      budget,
      status: file?.status ?? "blocked",
      round: input.tasks,
      tokens_used: input.tokensUsed,
    };
    const stop = async (outcome: GoalOutcomeStatus, write: boolean): Promise<StopHookResult> => {
      goal.status = outcome;
      // A broken file keeps its scene: nothing is written over what the model left.
      if (write) await writeGoalFile(opts.goalFilePath, goal);
      return {
        decision: "stop",
        reason: `${outcome} · ${goal.round} round${goal.round === 1 ? "" : "s"} · ${tokens(goal)}`,
        output: record(goal),
      };
    };
    if (file === null) return stop("blocked", false);
    if (isGoalOutcome(file.status)) return stop(file.status, true);
    if (input.stopReason !== "completed") return stop("aborted", true);
    if (file.status === "wrapping_up") return stop("budget_limited", true);
    if (goal.round >= GOAL_MAX_ROUNDS) return stop("aborted", true);
    goal.round += 1;
    const wrapUp = budget > 0 && goal.tokens_used >= budget;
    goal.status = wrapUp ? "wrapping_up" : "active";
    await writeGoalFile(opts.goalFilePath, goal);
    const compose = wrapUp ? goalWrapUpMessage : goalRoundMessage;
    return {
      decision: "continue",
      input: compose({ goal, goalFilePath: opts.goalFilePath, body: objective }),
      reason: `round ${goal.round}${wrapUp ? " (wrap-up: budget reached)" : ""} · ${tokens(goal)}`,
      output: record(goal),
    };
  };

  return { input, hook: { name: GOAL_HOOK_NAME, run: decide } };
}

/** What a goal hook event records: the file's state after the decision. */
export interface GoalProgress {
  decision: "continue" | "stop";
  status: string;
  round: number;
  tokensUsed: number;
  budget: number;
}

/** The goal hook's record carried by a `hook` event of the main session, or null for any other message. */
export function goalProgressOf(msg: OmniMessage): GoalProgress | null {
  if (msg.origin && msg.origin.length > 0) return null;
  if (!isEventMessage(msg) || msg.payload.type !== "hook") return null;
  const p = msg.payload;
  if (p.name !== GOAL_HOOK_NAME || p.decision === undefined || !p.output) return null;
  const o = p.output;
  return {
    decision: p.decision,
    status: String(o.status ?? ""),
    round: Number(o.round ?? 0),
    tokensUsed: Number(o.tokens_used ?? 0),
    budget: Number(o.budget ?? UNLIMITED_BUDGET),
  };
}

/** How a goal ended plus its counters (host-shaped: the CLI's summary line, the server's goal_finished event). */
export interface GoalOutcome {
  outcome: GoalOutcomeStatus;
  /** Rounds actually run (the wrap-up round counts). */
  rounds: number;
  tokensUsed: number;
}

/** The goal outcome carried by the goal hook's `stop` event, or null for every other message. */
export function goalOutcomeOf(msg: OmniMessage): GoalOutcome | null {
  const p = goalProgressOf(msg);
  if (!p || p.decision !== "stop" || !isGoalOutcome(p.status)) return null;
  return { outcome: p.status, rounds: p.round, tokensUsed: p.tokensUsed };
}

/**
 * Whether this message is a goal round's injected input: the main-session user text carrying
 * the `[goal]` block (round 1 from `startGoal`, later rounds from the hook's `continue`).
 * Hosts use it as the round boundary (the CLI's round line, the Web server's goal_round event).
 */
export function isGoalRoundInput(msg: OmniMessage): boolean {
  if (msg.origin && msg.origin.length > 0) return false;
  if (!isModelMessage(msg) || msg.payload.type !== "text") return false;
  const p = msg.payload as { role?: string; text?: string };
  return p.role === "user" && parseGoalMessage(p.text ?? "") !== null;
}
