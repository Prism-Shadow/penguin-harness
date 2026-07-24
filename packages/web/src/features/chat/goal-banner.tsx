/**
 * Goal-mode banners.
 *
 * - `GoalRoundBanner`: the per-round `<goal_task>` injected input collapsed into a one-line
 *   notice in the message stream (same treatment as the scheduled-task origin block; the
 *   Trace page shows the raw block).
 * - `GoalStatusBanner`: the live goal card above the composer — objective excerpt, round
 *   count, token usage against the budget, and the terminal state once the run ends. The
 *   stop control is the regular abort (one signal spans the whole goal loop server-side).
 */
import { S } from "../../lib/strings";
import { humanizeTokens } from "../../lib/format";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { GOAL_ICON, UNLIMITED_BUDGET } from "./goal-use";
import type { GoalBannerState } from "./goal-use";

export function GoalRoundBanner({ round }: { round: number }) {
  return (
    <p className="anim-msg my-2 flex w-fit items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
      <GlyphIcon d={GOAL_ICON} className="text-gray-400 dark:text-gray-500" />
      {S.chat.goalRoundBanner(round)}
    </p>
  );
}

export function GoalStatusBanner({ goal }: { goal: GoalBannerState }) {
  const tokens =
    goal.budget > 0 && goal.budget !== UNLIMITED_BUDGET
      ? `${humanizeTokens(goal.used)}/${humanizeTokens(goal.budget)}`
      : humanizeTokens(goal.used);
  const finished = goal.status !== "active";
  return (
    <div className="anim-fade mb-2 flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
      <GlyphIcon d={GOAL_ICON} className="shrink-0 text-gray-400 dark:text-gray-500" />
      <span className="min-w-0 flex-1 truncate" title={goal.objective}>
        {goal.objective}
      </span>
      <span className="shrink-0 text-gray-400 dark:text-gray-500">
        {S.chat.goalProgress(goal.rounds, tokens)}
      </span>
      <span
        className={`shrink-0 rounded px-1.5 py-0.5 ${
          finished
            ? goal.status === "complete"
              ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
              : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
            : "bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
        }`}
      >
        {S.chat.goalStatus[goal.status]}
      </span>
    </div>
  );
}
