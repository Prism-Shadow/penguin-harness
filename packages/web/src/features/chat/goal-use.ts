/**
 * Goal-mode logic for the chat UI (pure, unit-tested).
 *
 * The `<goal_task>` block is the goal runner's per-round injected input (core
 * goal-prompts.ts); the message stream collapses it into a one-line "goal round" banner —
 * the message body IS the block (nothing follows it), unlike `<use_skills>`, which prefixes
 * user text. The Trace page still shows the raw block.
 *
 * Budget input parsing mirrors the CLI's `/goal:<budget>` grammar: a positive number with an
 * optional k/m suffix; an empty input means no budget (UNLIMITED_BUDGET).
 */

/** Mirrors core's UNLIMITED_BUDGET (the web bundle doesn't import the core package). */
export const UNLIMITED_BUDGET = -1;

/** Crosshair/target icon (24×24 line path): goal-mode UI (chip, plus-menu item, banner). */
export const GOAL_ICON =
  "M12 3v3M12 18v3M3 12h3M18 12h3M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z";

/**
 * Recognizes a goal round's injected input: a message that **starts with** a `<goal_task>`
 * block whose first line carries `round: N`. Returns the round number, or null when the
 * message isn't a goal block (rendered as normal user text then).
 */
export function parseGoalTaskMessage(text: string): { round: number } | null {
  const m = /^<goal_task>\nround: (\d+)\n[\s\S]*?<\/goal_task>/.exec(text);
  if (!m) return null;
  const round = Number(m[1]);
  return Number.isInteger(round) && round > 0 ? { round } : null;
}

/** What the goal banner shows (fed from goal_* server events, or the goal_state row on load). */
export interface GoalBannerState {
  objective: string;
  status: "active" | "complete" | "blocked" | "budget_limited" | "aborted";
  /** Token budget; UNLIMITED_BUDGET (-1) = none. */
  budget: number;
  used: number;
  rounds: number;
}

/**
 * Parses the goal chip's budget input: `""` = no budget (UNLIMITED_BUDGET); `500k` / `2m` /
 * plain positive integers; anything else is invalid (null — the send button stays disabled).
 */
export function parseBudgetInput(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return UNLIMITED_BUDGET;
  const m = /^(\d+(?:\.\d+)?)([km])?$/i.exec(trimmed);
  if (!m) return null;
  const scale = m[2]?.toLowerCase() === "m" ? 1_000_000 : m[2]?.toLowerCase() === "k" ? 1_000 : 1;
  const value = Math.round(Number(m[1]) * scale);
  return value > 0 ? value : null;
}
