/**
 * Goal-mode logic for the chat UI (pure, unit-tested).
 *
 * Round inputs carry no goal-specific text protocol: the plugin's messages arrive as
 * ordinary user texts stamped `sender: "harness"` and render like any other user message
 * (message-item.tsx adds the origin caption). Budget input parsing mirrors the CLI's
 * `/goal:<budget>` grammar: a positive number with an optional k/m suffix; an empty input
 * means no budget (UNLIMITED_BUDGET).
 */

/** Mirrors core's UNLIMITED_BUDGET (kept local: the constant is not part of the omnimessage bundle). */
export const UNLIMITED_BUDGET = -1;

/** Bullseye/arrow icon (24×24 line path): goal-mode UI (chip, plus-menu item, banner). */
export const GOAL_ICON =
  "M21 12A9 9 0 1 1 12 3M17 12A5 5 0 1 1 12 7M12 12L15 9V5L18 2V6H22L19 9H15";

/** What the goal banner shows (fed from goal_* server events, or the Session's GOAL.json via GET /goal on load). */
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
