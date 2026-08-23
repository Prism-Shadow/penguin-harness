/**
 * Goal-mode loop driver: repeatedly runs Tasks until the goal file says stop. This is the
 * engine room of `session.run(input, { goal })` — Session supplies the per-round Task runner
 * (its own single-Task path, approval/signal/thinking level already applied) and this module
 * owns the round protocol; it is not part of the SDK surface.
 *
 * Each round's `[goal]`-prefixed user message is yielded **before** the round runs — the
 * Task runner never yields its own input, and subscribers need the round input on the stream
 * (the Trace is written by the engine as usual). The final yield is always exactly one
 * `goal_finished` event message carrying the outcome; there is no generator return value.
 *
 * Termination is decided from these sources only:
 * - the goal file's status (`complete` / `blocked`, written by the model; parse failures
 *   normalize to `blocked` — see goal-file.ts),
 * - the loop's own token accounting against the budget (internal counters; the budget
 *   line in each round's block is composed from them, never read from anywhere),
 * - a main-session abort (LLM failure after retries, user interrupt) or a final assistant
 *   notice with `stop_reason: "failed"` that is NOT the engine's own max_turns sentinel
 *   (an output-length finish, say): the model never reached the file in a way that would
 *   change the outcome, so re-firing would loop the same failure forever, and
 * - a hard round cap (`maxRounds`, default 100) as a runaway backstop independent of the
 *   budget — without it an unbudgeted goal whose model simply never writes the file would
 *   loop without bound; an explicit -1 disables the cap.
 * All of these stop the loop without re-firing. A round the engine cut off at the per-Task
 * turn cap (`max_turns`) is NOT one of them: it ends that Task and the loop starts the next
 * round, which carries a fresh turn budget (`max_turns` bounds one Task, not the goal). The
 * workspace, goal file, and the cut-off round's unsubmitted tool outputs (held as engine
 * carry-over) survive into the next round, so progress is preserved. The loop writes GOAL.yaml
 * exactly once,
 * at creation; afterwards it only READS `status` — every ending leaves the model's own
 * last write on disk (system endings exist only as the `goal_finished` outcome), which is
 * exactly the resume point an interrupted goal wants.
 *
 * Token accounting is incremental, "uncached input + output": every `token_usage` event on
 * the stream — including origin-marked ones from subagent sessions, which are part of the
 * goal's cost — contributes `request.total - request.cache_read`.
 */
import { goalFinished, isEventMessage, isModelMessage, userText } from "../omnimessage/index.js";
import type { GoalOutcomeStatus, OmniMessage } from "../omnimessage/index.js";
import { stripLeadingMarkerBlocks } from "../omnimessage/markers/index.js";
import { readGoalStatus, writeGoalFile, UNLIMITED_BUDGET } from "./goal-file.js";
import { goalRoundMessage, goalWrapUpMessage } from "./goal-prompts.js";
import { goalTokenDelta } from "./goal-stream.js";

/** The slice of Session the loop drives: one Task per round (structural, so tests can substitute a fake). */
export interface GoalRoundRunner {
  run(newMessages: OmniMessage[]): AsyncGenerator<OmniMessage>;
}

export interface GoalLoopOptions {
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
  /**
   * Hard cap on regular rounds, a runaway backstop independent of the budget (the budget
   * wrap-up may run one round past it, so the true bound is maxRounds + 1 — the wrap-up
   * fires once and cannot loop). Default 100 — far above any legitimate goal (each round is
   * a full Task), so hosts don't expose it as a knob; an explicit -1 disables the cap.
   */
  maxRounds?: number;
  signal?: AbortSignal;
}

/** Default `maxRounds`: the runaway backstop for goals with no (or a huge) budget. */
export const GOAL_MAX_ROUNDS = 100;

/** Whether this message is the **main** session's abort event (subagent aborts don't end the goal). */
function isMainAbort(msg: OmniMessage): boolean {
  return isEventMessage(msg) && msg.payload.type === "abort" && (msg.origin?.length ?? 0) === 0;
}

/**
 * The main session's assistant text's `stop_reason`, or null. Used to track how a round
 * ended: a "failed" final text with no abort event is the one failure mode that neither
 * `isMainAbort` nor the goal file can see.
 */
function mainAssistantStopReason(msg: OmniMessage): string | null {
  if (msg.origin && msg.origin.length > 0) return null;
  if (!isModelMessage(msg) || msg.payload.type !== "text") return null;
  const p = msg.payload as { role?: string; stop_reason?: string };
  return p.role === "assistant" ? (p.stop_reason ?? "completed") : null;
}

/**
 * Whether this is the engine's max_turns cutoff notice: the main session's final assistant
 * text carrying the engine's own `[reached max turns (…); stopping]` sentinel. The sentinel
 * text is matched because the engine emits it verbatim (see `ContextEngine.emitMaxTurns`) and
 * stamps it with the same `stop_reason: "failed"` it stamps an output-length finish — the
 * sentinel is what marks a recoverable round boundary rather than a real failure.
 */
function isMaxTurnsCutoff(msg: OmniMessage): boolean {
  if (msg.origin && msg.origin.length > 0) return false;
  if (!isModelMessage(msg) || msg.payload.type !== "text") return false;
  const p = msg.payload as { role?: string; text?: string };
  return p.role === "assistant" && (p.text ?? "").startsWith("[reached max turns (");
}

export async function* runGoalLoop(
  session: GoalRoundRunner,
  opts: GoalLoopOptions,
): AsyncGenerator<OmniMessage> {
  const budget = opts.budget ?? UNLIMITED_BUDGET;
  const maxRounds = opts.maxRounds ?? GOAL_MAX_ROUNDS;
  // The objective is the user's own text: leading machine-prefixed blocks (a [use_skills]
  // invocation, a handoff note) belong to round 1's body but not to the re-injected task
  // statement or the goal file.
  const stripped = stripLeadingMarkerBlocks(opts.text).trim();
  const objective = stripped || opts.text.trim();
  let used = 0;
  let rounds = 0;
  let aborted = false;
  let roundFailed = false;

  /** Runs one round: yields the injected input, then the Task's stream, accounting as it goes. */
  async function* round(kind: "regular" | "wrap-up"): AsyncGenerator<OmniMessage> {
    rounds++;
    roundFailed = false;
    const compose = kind === "regular" ? goalRoundMessage : goalWrapUpMessage;
    const input = userText(
      compose({
        objective,
        goalFilePath: opts.goalFilePath,
        round: rounds,
        tokensUsed: used,
        budget,
        // Round 1 carries the caller's input verbatim; later rounds re-inject the objective.
        body: rounds === 1 ? opts.text : objective,
      }),
    );
    yield input;
    for await (const msg of session.run([input])) {
      used += goalTokenDelta(msg);
      if (isMainAbort(msg)) aborted = true;
      // The LAST assistant text decides: a mid-round failed notice followed by normal text
      // means the round recovered. The engine's max_turns sentinel is a round boundary, not a
      // failure — excluded here so it falls through to the next round below.
      const stop = mainAssistantStopReason(msg);
      if (stop !== null) roundFailed = stop === "failed" && !isMaxTurnsCutoff(msg);
      yield msg;
    }
  }

  const finish = (outcome: GoalOutcomeStatus) => goalFinished(outcome, rounds, used);

  // The one and only system write: afterwards the file belongs to the model.
  await writeGoalFile(opts.goalFilePath, { objective, status: "active" });

  for (;;) {
    // An abort landing BETWEEN rounds produces no abort event on any stream — without this
    // check the loop would fire a phantom round whose [goal] input the already-aborted
    // engine holds as carry-over, leaking the block into the user's next message.
    if (opts.signal?.aborted) {
      yield finish("aborted");
      return;
    }
    // Runaway backstop, independent of the budget (which may be unlimited); -1 disables.
    if (maxRounds > 0 && rounds >= maxRounds) {
      yield finish("aborted");
      return;
    }
    yield* round("regular");
    // Abort wins over whatever is in the file: the workspace and goal file are the resume
    // point, exactly as the model last left them.
    if (aborted) {
      yield finish("aborted");
      return;
    }

    const status = await readGoalStatus(opts.goalFilePath);
    if (status !== "active") {
      yield finish(status);
      return;
    }
    // A round the engine cut off with a non-recoverable "failed" final text (an output-length
    // finish, say) is terminal, not a reason to re-fire: the model never reached the file in a
    // way that would change the outcome, so re-firing would loop the same failure. The engine's
    // max_turns cutoff is excluded from `roundFailed` above and falls through as a round
    // boundary instead — `max_turns` bounds one Task, not the goal, and the next round carries
    // a fresh turn budget plus the cut-off round's carry-over. A written terminal status above
    // still wins (a post-completion cutoff doesn't undo the completion).
    if (roundFailed) {
      yield finish("aborted");
      return;
    }

    if (budget > 0 && used >= budget) {
      // Same phantom-round guard as at the loop top, for the wrap-up round.
      if (opts.signal?.aborted) {
        yield finish("aborted");
        return;
      }
      // One wrap-up round, then the system-side terminal outcome — unless the model could
      // truthfully complete during wrap-up (its template forbids a courtesy `complete`).
      yield* round("wrap-up");
      if (aborted) {
        yield finish("aborted");
        return;
      }
      const wrapStatus = await readGoalStatus(opts.goalFilePath);
      yield finish(wrapStatus === "complete" ? "complete" : "budget_limited");
      return;
    }
  }
}
