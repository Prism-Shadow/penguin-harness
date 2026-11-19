import { useRef } from "react";
import { Button } from "../../actions/button/button";
import { DurationSlot } from "../../feedback/duration-slot/duration-slot";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";
import { StatusIcon } from "../../icons/status-icon/status-icon";
import {
  ACTIVITY_HEAD_HOVER_CLASS,
  ActivityMarkSlot,
  ActivityToggle,
} from "../../layout/disclosure-row/disclosure-row";
import { PageField } from "../../navigation/group-header/page-field";
import { Pager } from "../../navigation/group-header/pager";
import type { ActivityStepNavigation, ActivityStepSummary } from "./activity-group";

interface CompactStepHeaderProps {
  summary: ActivityStepSummary;
  navigation: ActivityStepNavigation;
  page: number;
  total: number;
  totalStartMs?: number;
  totalDurationMs?: number;
  totalRunning: boolean;
  open: boolean;
  goTo: (page: number) => void;
  toggle: () => void;
  showAction?: () => void;
}

/*
 * The line has to hold the step's name, three pager buttons and the total time on a 320px phone
 * at the user's largest text size. Two rungs make room:
 * - below `sm` the pager drops its gaps and its buttons take a fixed 24px rather than the
 *   rem-sized 1.5rem, which grows with the text size, and the total gives up the room it keeps
 *   for a longer time;
 * - below 380px (the narrowest phones) the chevron goes too, and the header button and the total
 *   drop their inline padding. The open state stays in `aria-expanded`.
 */
const PAGER_PHONE_CLASS = "max-sm:gap-0 max-sm:px-0 max-sm:[&>button]:w-[24px]";
const HEAD_BUTTON_NARROWEST_CLASS = "max-[380px]:px-0";
const HIDDEN_NARROWEST_CLASS = "max-[380px]:hidden";
const ELAPSED_NARROWEST_CLASS = "max-[380px]:ps-0.5";
/*
 * The total keeps room for five figures ("12.7s", "1m30s", "10m0s"), right-aligned at the line's
 * end, so the pager beside it holds still while the clock ticks through its first minutes.
 */
const ELAPSED_ROOM_CLASS = "sm:min-w-[5ch] text-end";

/**
 * A single sticky line: the step, then the pager, then the run's total time at the far end. Paging
 * is available on a closed group and never toggles it. The step number in the pager can be typed
 * over to go to a step (`PageField`); the time carries no words, its name is its tooltip.
 */
export function CompactStepHeader({
  summary,
  navigation,
  page,
  total,
  totalStartMs,
  totalDurationMs,
  totalRunning,
  open,
  goTo,
  toggle,
  showAction,
}: CompactStepHeaderProps) {
  const controls = useRef<HTMLDivElement>(null);
  function change(page: number) {
    // A button may become disabled or disappear at either end. Keep arrow keys working.
    if (controls.current?.contains(document.activeElement))
      controls.current.focus({ preventScroll: true });
    goTo(page);
  }
  const [before, after] = navigation.stepWords;
  const position = `${before}${page + 1}${after}`;
  return (
    <>
      <button
        type="button"
        data-group-header
        aria-expanded={open}
        onClick={toggle}
        className={`flex min-w-0 flex-1 items-center gap-1 self-stretch px-1 text-left ${HEAD_BUTTON_NARROWEST_CLASS} sm:gap-2 sm:px-2 ${ACTIVITY_HEAD_HOVER_CLASS}`}
      >
        <ActivityMarkSlot mark={<StatusIcon state={summary.state} label={summary.stateLabel} />} />
        <span className="flex min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap [scrollbar-width:none] sm:gap-2 sm:overflow-hidden">
          <span
            data-slot="label"
            className="shrink-0 sm:min-w-0 sm:shrink sm:truncate text-xs font-semibold"
            data-tooltip={summary.label}
          >
            {summary.label}
          </span>
          {summary.description && (
            <span
              data-slot="detail"
              className="shrink-0 sm:min-w-0 sm:shrink sm:truncate text-xs text-fg-muted"
              data-tooltip={summary.description}
            >
              {summary.description}
            </span>
          )}
          {summary.path && (
            <span
              data-slot="detail"
              className="shrink-0 sm:min-w-0 sm:shrink sm:truncate font-mono text-xs text-fg-subtle"
              data-tooltip={summary.path.full}
              data-tooltip-content="code"
              data-tooltip-extra={summary.path.full !== summary.path.short || undefined}
            >
              {summary.path.short}
            </span>
          )}
        </span>
        <span className={`contents ${HIDDEN_NARROWEST_CLASS}`}>
          <ActivityToggle open={open} />
        </span>
      </button>
      <div
        ref={controls}
        role="group"
        data-step-navigation=""
        aria-label={position}
        tabIndex={-1}
        className="ms-auto flex shrink-0 items-center"
        onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const next = page + (event.key === "ArrowLeft" ? -1 : 1);
          if (next >= 0 && next < total) change(next);
        }}
      >
        {showAction && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={navigation.waiting}
            data-tooltip={navigation.waiting}
            onClick={() => {
              controls.current?.focus({ preventScroll: true });
              showAction();
            }}
          >
            <GlyphIcon d={ICONS.hourglass} size={14} />
          </Button>
        )}
        <Pager
          page={page}
          pageCount={total}
          onChange={change}
          previousLabel={navigation.previous}
          nextLabel={navigation.next}
          lastPageLabel={navigation.latest}
          readout={
            <>
              {/* The words aloud as one phrase, as the live readout announces a step. */}
              <span className="sr-only">{position}</span>
              <span aria-hidden="true">{before}</span>
              <PageField page={page} pageCount={total} onChange={goTo} label={navigation.jump} />
              <span aria-hidden="true">{after}</span>
            </>
          }
          className={`whitespace-nowrap ${PAGER_PHONE_CLASS}`}
        />
      </div>
      {(totalRunning || totalDurationMs !== undefined) && (
        <span
          data-step-elapsed=""
          data-tooltip={navigation.elapsed}
          className={`flex shrink-0 justify-end whitespace-nowrap ps-1 ${ELAPSED_NARROWEST_CLASS}`}
        >
          <span className="sr-only">{navigation.elapsed}</span>
          <DurationSlot
            running={totalRunning}
            sinceMs={totalStartMs}
            durationMs={totalDurationMs}
            className={ELAPSED_ROOM_CLASS}
          />
        </span>
      )}
    </>
  );
}
