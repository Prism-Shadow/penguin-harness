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

/** Bullseye/arrow icon (24×24 line path): goal-mode UI (chip, plus-menu item, banner). */
export const GOAL_ICON =
  "M21 12A9 9 0 1 1 12 3M17 12A5 5 0 1 1 12 7M12 12L15 9V5L18 2V6H22L19 9H15";

/** Reverse of core's escapeXmlText. `&amp;` must go LAST, or an escaped literal `&amp;lt;` would double-unescape into `<`. */
function unescapeXmlText(input: string): string {
  return input.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/**
 * Recognizes a goal round's injected input: a message that **starts with** a `<goal_task>`
 * block whose first line carries `round: N`. Returns the round number plus the block's
 * objective (unescaped — round 1's banner shows it, so the user's submitted text stays
 * visible in the conversation even after the goal ends and the live banner is gone), or
 * null when the message isn't a goal block (rendered as normal user text then).
 */
export function parseGoalTaskMessage(text: string): { round: number; objective: string } | null {
  const m = /^<goal_task>\nround: (\d+)\n[\s\S]*?<\/goal_task>/.exec(text);
  if (!m) return null;
  const round = Number(m[1]);
  if (!Number.isInteger(round) || round <= 0) return null;
  // The escaped objective cannot contain a literal `</objective>`, so non-greedy is exact.
  const obj = /<objective>\n([\s\S]*?)\n<\/objective>/.exec(m[0]);
  return { round, objective: obj ? unescapeXmlText(obj[1]!) : "" };
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
