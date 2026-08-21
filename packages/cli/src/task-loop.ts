/**
 * Consumption loop that drives a Task to completion (CLI side, shared by run and chat).
 *
 * New protocol: `session.run(prompt, { signal, approve })` runs the entire ReAct loop in one
 * call — within a turn, the engine invokes the `approve` callback for each tool_call, executing
 * it on allow, with execution possibly overlapping. The CLI only needs to consume the output
 * stream and supply `approve`. The approval strategy is determined by the permission mode
 * (allow-all / deny-all / read-only / always-ask per-call approval).
 *
 * Goal mode rides the same call (`opts.goal` → `session.run(prompt, { goal })`): core loops
 * the rounds inside the one run, so this loop only adds the per-round rendering rhythm —
 * a dim round line at each `[goal]` round boundary, per-round stats via `endTask`, and the
 * outcome summary read from the stream's terminal `goal_finished` event.
 */
import {
  approvalDecisionOf,
  goalFinishedOf,
  isEventMessage,
  isGoalRoundInput,
} from "@prismshadow/penguin-core";
import type {
  ApproveFn,
  GoalOutcome,
  OmniMessage,
  Session,
  ThinkingLevelName,
} from "@prismshadow/penguin-core";
import { dim, humanizeTokens } from "./render.js";
import type { StreamRenderer } from "./render.js";
import { makeApprove, promptApproval, type ApprovalMode } from "./approval.js";
import type { Messages } from "./i18n.js";

export interface RunTaskOptions {
  /** Approval mode (default allow-all). */
  mode?: ApprovalMode;
  /** Interrupt signal (Ctrl-C, etc.). */
  signal?: AbortSignal;
  /**
   * Per-run thinking-level override (`RunOptions.thinkingLevel`); omitted = the Session's
   * construction-time default. In goal mode core reuses it for every round.
   */
  thinkingLevel?: ThinkingLevelName;
  renderer: StreamRenderer;
  /** The actual Q&A for interactive approval; defaults to the one-off `promptApproval`. */
  interactivePrompt?: ApproveFn;
  /** Message set. */
  t: Messages;
  /**
   * Present = goal mode: the prompt's text is the objective and the one `session.run` loops
   * until the goal reaches a terminal state (a single AbortSignal spans every round). `out`
   * receives the dim round/summary lines the renderer doesn't own.
   */
  goal?: { budget: number; out: NodeJS.WritableStream };
}

/** Result of one Task: `aborted` = the Task ended with an abort event (LLM failure/reconnect exhausted/user interrupt); `goal` = the outcome of a goal-mode run (absent when the stream was cut off before the terminal event). */
export interface RunTaskResult {
  aborted: boolean;
  goal?: GoalOutcome;
}

export async function runTask(
  session: Session,
  prompt: OmniMessage[],
  opts: RunTaskOptions,
): Promise<RunTaskResult> {
  const basePrompt: ApproveFn = opts.interactivePrompt ?? (() => promptApproval({ t: opts.t }));
  // Lock the renderer while waiting for the user's approval input: messages from concurrent
  // tools/subsessions are queued and released together once the Q&A finishes, so the prompt
  // isn't scrambled by later output. The pending tool_call is passed in so its call line stays
  // right before the prompt; the approval result is rendered in place **before unlocking** —
  // "tool call → approval prompt → approval result" stays three consecutive lines, for both
  // the main Agent and subagents (messages arriving via the async pipeline may lag behind the
  // approval callback, hence render-in-place plus de-duplication of the copy).
  //
  // Serialization: the parent session and a run_subagent child session share this callback and
  // may request approval concurrently (the parent is waiting on one approval while an
  // already-approved child session starts its own). Concurrent prompts would clobber the same
  // Q&A state and fight over the same stdin (one answer resolving two questions, leaving the
  // other permanently stuck); a promise chain queues them so only one question is asked at a
  // time.
  let promptChain: Promise<unknown> = Promise.resolve();
  const interactivePrompt: ApproveFn = (tc) => {
    const result = promptChain.then(async () => {
      opts.renderer.beginUserPrompt(tc);
      try {
        const outcome = await basePrompt(tc);
        opts.renderer.noteApprovalDecision(tc, approvalDecisionOf(outcome));
        return outcome;
      } finally {
        opts.renderer.endUserPrompt();
      }
    });
    promptChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const approveByMode = makeApprove({
    mode: opts.mode ?? "allow-all",
    toolPermission: (name) => session.toolPermission(name),
    interactivePrompt,
  });
  // The auto-approval path (allow-all / deny-all / read-only approvals) has no prompt: it
  // likewise renders the "call line → approval result" pair in place; the interactive path's
  // already-rendered copy is idempotently de-duplicated inside note.
  const approve: ApproveFn = async (tc) => {
    // A refusal (the sandbox command policy answers with one) is forwarded whole: the
    // renderer only needs the allow/deny, but the engine needs the source it carries.
    const outcome = await approveByMode(tc);
    opts.renderer.noteApprovalDecision(tc, approvalDecisionOf(outcome));
    return outcome;
  };

  // A single run drives the whole ReAct loop (the engine requests approval per call and runs
  // tools concurrently within a turn). Once the task ends (including on error), endTask
  // prints this task's stats (context/Token/elapsed time). The engine collapses failures
  // (auth errors, reconnect exhausted, etc.) into a main-session abort event rather than
  // throwing; the result reported here reflects that, for `penguin run` to map to
  // an exit code.
  //
  // In goal mode the round boundaries are the injected `[goal]` user messages core yields
  // before each round: stats settle per round (the per-Task rhythm of a normal chat), so
  // `segmentStartedAt` tracks the current round rather than the whole run.
  const goal = opts.goal;
  const startedAt = Date.now();
  let segmentStartedAt = startedAt;
  let aborted = false;
  let round = 0;
  let outcome: GoalOutcome | undefined;
  try {
    for await (const msg of session.run(prompt, {
      approve,
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.thinkingLevel !== undefined ? { thinkingLevel: opts.thinkingLevel } : {}),
      ...(goal ? { goal: { budget: goal.budget } } : {}),
    })) {
      if (isEventMessage(msg) && msg.payload.type === "abort" && (msg.origin?.length ?? 0) === 0) {
        aborted = true;
      }
      if (goal) {
        if (isGoalRoundInput(msg)) {
          // Settle the previous round's stats before announcing the next (endTask is what
          // prints the per-task `[stats]` line in a normal chat).
          if (round > 0) opts.renderer.endTask(Date.now() - segmentStartedAt);
          round++;
          segmentStartedAt = Date.now();
          goal.out.write(`${dim(opts.t.goalRound(round))}\n`);
        }
        outcome = goalFinishedOf(msg) ?? outcome;
      }
      opts.renderer.handle(msg);
    }
  } finally {
    opts.renderer.endTask(Date.now() - segmentStartedAt);
  }
  if (goal && outcome) {
    goal.out.write(
      `${dim(opts.t.goalFinished(outcome.outcome, outcome.rounds, humanizeTokens(outcome.tokensUsed)))}\n`,
    );
  }
  return { aborted, ...(outcome !== undefined ? { goal: outcome } : {}) };
}
