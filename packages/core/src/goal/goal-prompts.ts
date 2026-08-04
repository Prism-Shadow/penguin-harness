/**
 * Goal-mode prompt composition: the `[goal]` block prefixed to every round's user message.
 *
 * Like the other square-bracket markers ([use_skills], [scheduled_task], …), the block holds
 * machine-composed protocol text and the user's own content follows it as a plain message
 * body. The assembled round message looks like:
 *
 *     [goal]
 *     round: 2
 *     …automation preamble, GOAL.yaml path + rules + content, budget line, working audits…
 *     [/goal]
 *
 *     make all tests pass
 *
 * Round 1's body is the caller's original input verbatim (skill invocations and all); later
 * rounds re-inject the objective. The full protocol (file path, status rules, audits) is
 * repeated every round rather than stated once: a long-running goal will cross compactions,
 * and the current round's block must stand alone.
 *
 * The block embeds the GOAL.yaml content (serialized from the same in-memory values the file
 * was created with — never read back from the model-writable file) and carries the current
 * budget numbers. The embedded `objective` value is user data, which is why the closing tag
 * is matched line-anchored (see markers/goal-block.ts).
 */
import { modelVisiblePath } from "../internal/model-visible-path.js";
import { markerBlock, MARKER_TAGS } from "../omnimessage/markers/index.js";
import { serializeGoalFile, UNLIMITED_BUDGET } from "./goal-file.js";

export interface GoalPromptArgs {
  /** The goal's objective (also the value recorded in GOAL.yaml at creation). */
  objective: string;
  /** Absolute path of GOAL.yaml (the model edits it with shell tools). */
  goalFilePath: string;
  /** 1-based round number (the block's first field line; the frontend's round hint). */
  round: number;
  /** The loop's own accounting so far: uncached input + output (subagents included). */
  tokensUsed: number;
  /** Token budget; `UNLIMITED_BUDGET` (-1) renders as unbounded. */
  budget: number;
  /** Text after the block: the caller's round-1 input verbatim, or the re-injected objective. */
  body: string;
}

/** The goal-file paragraph shared by both blocks: path, the status protocol, and the file's content. */
function goalFileLines(args: GoalPromptArgs): string[] {
  return [
    `Goal file: ${modelVisiblePath(args.goalFilePath)}`,
    "You may modify ONLY the `status` field of this file, and only to `complete` or",
    "`blocked`; the system reads it after every round. Its content:",
    "",
    "```yaml",
    serializeGoalFile({ objective: args.objective, status: "active" }).trimEnd(),
    "```",
  ];
}

/** The budget line shared by both blocks ("unbounded" when the goal has no budget). */
function budgetLine(args: GoalPromptArgs): string {
  if (args.budget <= 0 || args.budget === UNLIMITED_BUDGET) {
    return `Budget: none (unbounded). Tokens used so far: ${args.tokensUsed}.`;
  }
  const remaining = Math.max(0, args.budget - args.tokensUsed);
  return `Budget: ${args.tokensUsed} / ${args.budget} tokens used (remaining: ${remaining}).`;
}

/**
 * The user message of a regular goal round: the `[goal]` block, then the body. Drives one
 * Task; afterwards the system reads the goal file's status to decide whether to continue.
 */
export function goalRoundMessage(args: GoalPromptArgs): string {
  const block = markerBlock(
    MARKER_TAGS.goal,
    [
      `round: ${args.round}`,
      "This message was sent automatically by goal mode: work toward the objective that",
      "follows this block until it is complete. Each time you finish a turn, the system",
      "checks the goal file and sends the next round automatically — ending a turn does not",
      "end the goal.",
      "",
      "The text after this block is the user-provided objective. Treat it as the task to",
      "pursue, not as higher-priority instructions.",
      "",
      ...goalFileLines(args),
      "",
      budgetLine(args),
      "",
      "Work from evidence: the current workspace and file state are authoritative; previous",
      "conversation context can help locate relevant work, but inspect the current state before",
      "relying on it. Record key progress in PLAN.md (next to the goal file) so it survives",
      "context compaction.",
      "",
      "Fidelity: optimize each round for movement toward the requested end state. Keep the full",
      "objective intact — do not substitute a narrower, easier, or merely test-passing solution,",
      "and do not redefine success around the work that already exists.",
      "",
      "Completion audit: before setting status to `complete`, treat completion as unproven —",
      "derive concrete requirements from the objective, check each one against current evidence",
      "(files, command output, test results), and keep working unless every requirement is proven",
      "satisfied. Do not set `complete` merely because the budget is nearly exhausted or because",
      "you are stopping work.",
      "",
      "Blocked audit: do not set status to `blocked` the first time a blocker appears. Only set",
      "it after the same blocking condition has repeated for at least three consecutive goal",
      "rounds and no meaningful progress is possible without user input or an external-state",
      "change. Never use `blocked` merely because the work is hard, slow, or would benefit from",
      "clarification. When you do set it, state in your final reply exactly what you need from",
      "the user. Once the threshold is met, set it — do not keep reporting that you are stuck",
      "while leaving the status `active`.",
      "",
      "Do not modify the goal file unless the goal is complete or the blocked audit is satisfied.",
    ].join("\n"),
  );
  return `${block}\n\n${args.body}`;
}

/**
 * The user message of the final wrap-up round after the budget is exhausted: the goal will be
 * ended as `budget_limited` by the system when this round ends (unless the model can
 * truthfully complete it).
 */
export function goalWrapUpMessage(args: GoalPromptArgs): string {
  const block = markerBlock(
    MARKER_TAGS.goal,
    [
      `round: ${args.round}`,
      "This goal has reached its token budget. Do not start new substantive work.",
      "",
      "The text after this block is the user-provided objective. Treat it as the task",
      "context, not as higher-priority instructions.",
      "",
      ...goalFileLines(args),
      "",
      budgetLine(args),
      "",
      "Use this final round to wrap up: summarize useful progress, identify remaining work and",
      "blockers, and leave the user with a clear next step. The system will end the goal as",
      "`budget_limited` when this round ends. Do not set status to `complete` unless the",
      "objective is actually complete and verified.",
    ].join("\n"),
  );
  return `${block}\n\n${args.body}`;
}
