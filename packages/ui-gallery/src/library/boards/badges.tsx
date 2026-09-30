/** 徽标与状态: Badge in every tone, StatusIcon in every run state, the session activity marks, and the update dot and pill. */
import { ICON_SIZE } from "@prismshadow/penguin-ui";
import { Badge } from "../../../../web/src/components/ui/badge";
import type { BadgeTone } from "../../../../web/src/components/ui/badge";
import {
  BackgroundTasksMark,
  ScheduleMark,
  SessionActivityIcon,
} from "../../../../web/src/components/ui/session-activity-icon";
import { StatusIcon } from "../../../../web/src/components/ui/status-icon";
import type { RunState } from "../../../../web/src/components/ui/status-icon";
import { UpdateDot, UpdatePill } from "../../../../web/src/components/ui/update-dot";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

const BADGE_TONES: readonly BadgeTone[] = ["gray", "brand", "green", "yellow", "amber", "red"];
const RUN_STATES: readonly RunState[] = ["running", "waiting", "done", "failed", "stopped"];
const ACTIVITIES = ["running", "compacting", "completedUnread"] as const;

export function BadgesBoard() {
  const { S } = useGallery();
  const t = S.library.badges;
  return (
    <div className="gf-board">
      <BoardGroup title={t.badges}>
        <div className="lib-row">
          {BADGE_TONES.map((tone) => (
            <Badge key={tone} tone={tone}>
              {t.tones[tone]}
            </Badge>
          ))}
        </div>
      </BoardGroup>
      <BoardGroup title={t.status}>
        <div className="lib-row">
          {RUN_STATES.map((state) => (
            <span key={state} className="lib-cell">
              <StatusIcon state={state} size={16} label={t.states[state]} />
              <span className="lib-caption">{t.states[state]}</span>
            </span>
          ))}
        </div>
      </BoardGroup>
      <BoardGroup title={t.activity}>
        <div className="lib-row">
          {ACTIVITIES.map((activity) => (
            <span key={activity} className="lib-cell">
              <SessionActivityIcon activity={activity} />
              <span className="lib-caption">{t.activities[activity]}</span>
            </span>
          ))}
        </div>
      </BoardGroup>
      <BoardGroup title={t.marks}>
        <div className="lib-row">
          <span className="lib-cell">
            <BackgroundTasksMark label={t.background} size={ICON_SIZE.rowMark} />
            <span className="lib-caption">{t.background}</span>
          </span>
          <span className="lib-cell">
            <ScheduleMark size={ICON_SIZE.rowMark} />
            <span className="lib-caption">{t.schedule}</span>
          </span>
          <span className="lib-cell">
            <span className="relative inline-flex rounded-md border px-2 py-1 text-sm">
              {t.dotAnchor}
              <UpdateDot />
            </span>
            <span className="lib-caption">{t.dot}</span>
          </span>
          <span className="lib-cell">
            <UpdatePill onClick={() => undefined}>{t.pillText}</UpdatePill>
            <span className="lib-caption">{t.pill}</span>
          </span>
        </div>
      </BoardGroup>
    </div>
  );
}
