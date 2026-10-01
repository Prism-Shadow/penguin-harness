/**
 * `GoalStatusBanner`: the live goal card above the composer — objective excerpt, round
 * count, token usage against the budget, and the terminal state once the run ends. The
 * stop control is the regular abort (one signal spans the whole goal loop server-side).
 * (Round inputs themselves render as regular user messages with a harness-origin caption —
 * see message-item.tsx; no goal-specific message rendering remains.)
 */
import { Badge, GlyphIcon } from "@prismshadow/penguin-ui";
import type { ToneName } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { humanizeTokens } from "../../lib/format";
import { GOAL_ICON, UNLIMITED_BUDGET } from "./goal-use";
import type { GoalBannerState } from "./goal-use";

/** A run still going is neutral; one that ended reached its goal or stopped short of it. */
const STATUS_TONE: Record<GoalBannerState["status"], ToneName> = {
  active: "neutral",
  complete: "success",
  blocked: "attention",
  budget_limited: "attention",
  aborted: "attention",
};

export function GoalStatusBanner({ goal }: { goal: GoalBannerState }) {
  const tokens =
    goal.budget > 0 && goal.budget !== UNLIMITED_BUDGET
      ? `${humanizeTokens(goal.used)}/${humanizeTokens(goal.budget)}`
      : humanizeTokens(goal.used);
  return (
    <div className="anim-fade mb-2 flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
      <GlyphIcon d={GOAL_ICON} className="shrink-0 text-gray-400 dark:text-gray-500" />
      <span
        className="min-w-0 flex-1 truncate"
        data-tooltip={goal.objective}
        data-tooltip-content="text"
      >
        {goal.objective}
      </span>
      <span className="shrink-0 text-gray-400 dark:text-gray-500">
        {S.chat.goalProgress(goal.rounds, tokens)}
      </span>
      <Badge tone={STATUS_TONE[goal.status]} size="sm">
        {S.chat.goalStatus[goal.status]}
      </Badge>
    </div>
  );
}
