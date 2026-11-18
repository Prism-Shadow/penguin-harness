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
  terminal: boolean;
  open: boolean;
  goTo: (page: number) => void;
  toggle: () => void;
  showAction?: () => void;
}

/** A single sticky line. Paging is available on a closed group and never toggles it. */
export function CompactStepHeader({
  summary,
  navigation,
  page,
  total,
  terminal,
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
  const content = (
    <>
      <ActivityMarkSlot mark={<StatusIcon state={summary.state} label={summary.stateLabel} />} />
      <span
        data-slot="label"
        className="min-w-0 truncate text-xs font-semibold"
        data-tooltip={summary.label}
      >
        {summary.label}
      </span>
      <DurationSlot
        data-slot="detail"
        running={summary.state === "running"}
        sinceMs={summary.startMs}
        durationMs={summary.durationMs}
        offsetMs={summary.offsetMs}
      />
      {!terminal && <ActivityToggle open={open} />}
    </>
  );
  const summaryClass = "flex min-w-0 flex-1 items-center gap-2 self-stretch px-2 text-left";
  return (
    <>
      {terminal ? (
        <div className={summaryClass}>{content}</div>
      ) : (
        <button
          type="button"
          data-group-header
          aria-expanded={open}
          onClick={toggle}
          className={`${summaryClass} ${ACTIVITY_HEAD_HOVER_CLASS}`}
        >
          {content}
        </button>
      )}
      <div
        ref={controls}
        role="group"
        data-step-navigation=""
        aria-label={navigation.position(page + 1, total)}
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
        {page < total - 1 && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={navigation.latest}
            data-tooltip={navigation.latest}
            onClick={() => change(total - 1)}
          >
            <GlyphIcon d={ICONS.chevronRightPipe} size={14} />
          </Button>
        )}
        <Pager
          page={page}
          pageCount={total}
          onChange={change}
          previousLabel={navigation.previous}
          nextLabel={navigation.next}
          readoutLabel={navigation.position(page + 1, total)}
        />
      </div>
    </>
  );
}
