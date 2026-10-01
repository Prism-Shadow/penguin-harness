/**
 * `GoalStatusBanner`: the live goal line above the composer, a harness note (TranscriptNote)
 * across the column — objective excerpt, round count, token usage against the budget, and the
 * terminal state once the run ends. The stop control is the regular abort (one signal spans the
 * whole goal loop server-side). (Round inputs themselves render as regular user messages with a
 * harness-origin caption — see message-item.tsx; no goal-specific message rendering remains.)
 */
import { Badge, TranscriptNote } from "@prismshadow/penguin-ui";
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
    <TranscriptNote
      className="anim-fade mb-2"
      width="fill"
      mark={GOAL_ICON}
      label={S.chat.goalLabel}
      subject={goal.objective}
      truncate
      meta={[S.chat.goalProgress(goal.rounds, tokens)]}
      end={
        <Badge tone={STATUS_TONE[goal.status]} size="sm">
          {S.chat.goalStatus[goal.status]}
        </Badge>
      }
    />
  );
}
