/**
 * 徽标与状态: Badge in every tone and weight, the count, the state dot, StatusIcon in every run
 * state, the session activity marks, the update dot and pill, and the two readings — the stat
 * tile and the stat chip.
 */
import {
  ActivityIcon,
  BackgroundTasksMark,
  Badge,
  Count,
  Dot,
  ICONS,
  ICON_SIZE,
  ScheduleMark,
  StatChip,
  StatTile,
  StatusIcon,
  TONES,
  UpdateDot,
  UpdatePill,
} from "@prismshadow/penguin-ui";
import type { ActivityIconState, BadgeVariant, RunState } from "@prismshadow/penguin-ui";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

const BADGE_VARIANTS: readonly BadgeVariant[] = ["soft", "outline", "solid"];
const RUN_STATES: readonly RunState[] = ["running", "waiting", "done", "failed", "stopped"];
const ACTIVITIES: readonly ActivityIconState[] = ["running", "compacting", "completedUnread"];

export function BadgesBoard() {
  const { S } = useGallery();
  const t = S.library.badges;
  return (
    <div className="gf-board">
      <BoardGroup title={t.badges}>
        <div className="lib-stack lib-stack-wide">
          {BADGE_VARIANTS.map((variant) => (
            <div key={variant} className="lib-row">
              {TONES.map((tone) => (
                <Badge key={tone} tone={tone} variant={variant}>
                  {t.tones[tone]}
                </Badge>
              ))}
              <span className="lib-caption">{t.variants[variant]}</span>
            </div>
          ))}
        </div>
      </BoardGroup>
      <BoardGroup title={t.count}>
        <div className="lib-row">
          <Count n={3} />
          <Count n={42} />
          <Count n={120} max={99} />
        </div>
      </BoardGroup>
      <BoardGroup title={t.dots} aside={t.dotsHint}>
        <div className="lib-row">
          {TONES.map((tone) => (
            <span key={tone} className="lib-cell">
              <Dot tone={tone} size="md" />
              <code className="lib-caption">{tone}</code>
            </span>
          ))}
          <span className="lib-cell">
            <Dot tone="success" size="md" pulse label={t.live} />
            <span className="lib-caption">{t.live}</span>
          </span>
        </div>
      </BoardGroup>
      <BoardGroup title={t.status}>
        <div className="lib-row">
          {RUN_STATES.map((state) => (
            <span key={state} className="lib-cell">
              <StatusIcon state={state} label={t.states[state]} />
              <span className="lib-caption">{t.states[state]}</span>
            </span>
          ))}
        </div>
      </BoardGroup>
      <BoardGroup title={t.activity}>
        <div className="lib-row">
          {ACTIVITIES.map((activity) => (
            <span key={activity} className="lib-cell">
              <ActivityIcon activity={activity} label={t.activities[activity]} />
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
            <ScheduleMark label={t.schedule} size={ICON_SIZE.rowMark} />
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
      <BoardGroup title={t.statTile}>
        <div className="grid max-w-xl grid-cols-2 gap-3">
          <StatTile icon={ICONS.coin} label={t.spend} value="$12.40" detail={t.spendDetail} />
          <StatTile
            icon={ICONS.info}
            label={t.alerts}
            value={2}
            tone="danger"
            detail={t.alertsDetail}
          />
        </div>
      </BoardGroup>
      <BoardGroup title={t.statChip}>
        <div className="lib-row text-xs text-fg-subtle">
          <StatChip glyph={ICONS.arrowUpFromLine} value="18.2k" label={t.input} />
          <StatChip glyph={ICONS.arrowDownToLine} value="1.4k" label={t.output} />
          <StatChip glyph={ICONS.clockCompact} value="12.7s" compactValue="13s" label={t.elapsed} />
        </div>
      </BoardGroup>
    </div>
  );
}
