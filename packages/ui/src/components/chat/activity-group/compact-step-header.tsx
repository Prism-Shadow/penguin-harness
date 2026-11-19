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
 * The line has to hold the step's name, the total time and three pager buttons on a 320px phone
 * at the user's largest text size. Two rungs make room:
 * - below `sm` the pager drops its gaps and its buttons take a fixed 24px rather than the
 *   rem-sized 1.5rem, which grows with the text size, and the "Total time" words give way to the
 *   clock glyph;
 * - below 380px (the narrowest phones) the chevron and the clock glyph go too, and the header
 *   button drops its inline padding. The open state stays in `aria-expanded`.
 */
const PAGER_PHONE_CLASS = "max-sm:gap-0 max-sm:px-0 max-sm:[&>button]:w-[24px]";
const HEAD_BUTTON_NARROWEST_CLASS = "max-[380px]:px-0";
const HIDDEN_NARROWEST_CLASS = "max-[380px]:hidden";
const ELAPSED_NARROWEST_CLASS = "max-[380px]:ms-0.5";

/** A single sticky line. Paging is available on a closed group and never toggles it. */
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
  const position = navigation.position(page + 1);
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
      {(totalRunning || totalDurationMs !== undefined) && (
        <span
          data-step-elapsed=""
          data-tooltip={navigation.elapsed}
          className={`flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-fg-subtle ${ELAPSED_NARROWEST_CLASS}`}
        >
          <span className="sr-only sm:not-sr-only">{navigation.elapsed}</span>
          <span aria-hidden className={`${HIDDEN_NARROWEST_CLASS} sm:hidden`}>
            <GlyphIcon d={ICONS.clock} size={12} />
          </span>
          <DurationSlot
            running={totalRunning}
            sinceMs={totalStartMs}
            durationMs={totalDurationMs}
          />
        </span>
      )}
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
          readout={position}
          className={`whitespace-nowrap ${PAGER_PHONE_CLASS}`}
        />
      </div>
    </>
  );
}
