/**
 * The transcript's harness card: something the harness did or injected rather than the agent —
 * an MCP connection, a compaction, a background task settling, a message the harness wrote —
 * on the work group's own anatomy: the same card, the same sticky title bar (status icon, short
 * title, one-line detail, duration, chevron at the far right), so running, success and failure
 * are one row with only the icon and the detail changing. The duration follows the detail the
 * way the work group's count and duration do: the live clock while running, the settled span
 * once finished. A body makes the row expandable; collapsing while the stuck header sits above
 * the fold scrolls the card back into view.
 *
 * The body is one of two shapes. `rows` are the event's own steps (a compaction's sections, an
 * MCP connection's servers), hung off the head one tree level down exactly as a work group's
 * steps are; `children` is one piece the caller styles (a report in the output block).
 *
 * Expand policy, the work group's: the body opens while the step runs, so its rows are visible
 * as they are appended, and closes itself once the step settles, leaving the one-line summary
 * the row exists to be. The body's own rows never open with it. Once the reader toggles it, the
 * row is theirs: a later automatic change never fights them.
 *
 * Three hooks, the work group's: the card is a frame (its header the head, its body the body),
 * the header is an activity row of the `event` kind with the state folded onto the hook's three
 * (a failure is an error, anything settled is done), and the rows are a tree. So every theme
 * renders the card as it renders a work group — Primer's bordered card, Frost's lineless row
 * with its soft hover, Console's transcript line with the fold mark leading — and the title is
 * sentence case on the small rung, uppercased only by a theme's recipe.
 */
import { useEffect, useRef, useState } from "react";
import type { Key, ReactNode } from "react";
import { Chevron } from "../../icons/chevron/chevron";
import { StatusIcon } from "../../icons/status-icon/status-icon";
import type { RunState } from "../../icons/status-icon/status-icon";
import { DurationSlot } from "../../feedback/duration-slot/duration-slot";
import {
  ActivityProgress,
  DISCLOSURE_CARD_CLASS,
  DISCLOSURE_HEADER_ROW_CLASS,
  DISCLOSURE_HEADER_STICKY_CLASS,
  DISCLOSURE_HEADER_TITLE_CLASS,
  activityState,
} from "../../layout/disclosure-row/disclosure-row";

/** One of the event's steps under the head, keyed for React. */
export interface StepBannerRow {
  key: Key;
  content: ReactNode;
}

export interface StepBannerProps {
  state: RunState;
  /** The status icon's accessible name and tooltip, when the title does not already say the state. */
  stateLabel?: string;
  /** A mark naming the event in place of the status icon (the hook of an injected message). */
  icon?: ReactNode;
  /** The constant short label in the title slot: a fixed phrase, never a name, since a theme may recase it. */
  title: string;
  /** One line of status or result, where names go (servers, a failure's reason); truncates, with the full text as its tooltip. */
  detail?: string;
  /** While running, a live clock ticks from this timestamp. */
  liveSinceMs?: number;
  /** The settled wall time, once finished. */
  durationMs?: number;
  /**
   * The event's steps, one tree level under the head. Present (even empty, before the first
   * step lands) it adds the chevron; open while running, closed once settled.
   */
  rows?: readonly StepBannerRow[];
  /** A body of one piece the caller styles, in place of rows; its presence adds the chevron too. */
  children?: ReactNode;
}

export function StepBanner({
  state,
  stateLabel,
  icon,
  title,
  detail,
  liveSinceMs,
  durationMs,
  rows,
  children,
}: StepBannerProps) {
  const running = state === "running";
  const [open, setOpen] = useState(running);
  const userToggled = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const hasChildren = children !== undefined && children !== null;
  const expandable = rows !== undefined || hasChildren;

  // Before any manual toggle, follow "is this step still running"; afterwards the reader's choice
  // stands, so a finished row they opened stays open and one they closed mid-run stays closed.
  useEffect(() => {
    if (!userToggled.current) setOpen(running);
  }, [running]);

  const showDuration = running
    ? liveSinceMs !== undefined
    : durationMs !== undefined && durationMs > 0;

  const header = (
    <>
      <span data-slot="mark" className="flex shrink-0">
        {icon ?? <StatusIcon state={state} label={stateLabel} />}
      </span>
      <span
        data-slot="label"
        className={`${DISCLOSURE_HEADER_TITLE_CLASS} ${running ? "text-tone-success-fg" : "text-fg-muted"}`}
      >
        {title}
      </span>
      {/* Detail then duration, left-aligned after the title; the trailing spacer pins the
          chevron to the right edge. min-w-0 (not flex-1) lets a long detail truncate while a
          short one keeps the duration snug against it. */}
      {detail !== undefined && (
        <span
          data-slot="detail"
          data-tooltip={detail}
          data-tooltip-content="code"
          className="min-w-0 truncate font-mono text-xs text-fg-subtle"
        >
          {detail}
        </span>
      )}
      {showDuration && (
        <DurationSlot
          data-slot="detail"
          running={running}
          sinceMs={liveSinceMs}
          durationMs={durationMs}
        />
      )}
      <ActivityProgress running={running} />
      {/* The fold's chevron follows the words; `order-last` carries it past the spacer to the
          row's far edge unless a theme's recipe keeps it beside them. */}
      {expandable && (
        <span data-slot="toggle" className="order-last flex shrink-0">
          <Chevron open={open} className="text-fg-subtle" />
        </span>
      )}
      <span className="min-w-0 flex-1" />
    </>
  );

  return (
    // The card clips rather than hides its overflow: the sticky header must stick to the
    // message list's scrollport, and an overflow-hidden ancestor would become its scroll
    // container instead.
    <div ref={rootRef} className={`ui-frame ${DISCLOSURE_CARD_CLASS}`}>
      {expandable ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            userToggled.current = true;
            // Collapsing while the header is stuck: bring the (now header-only) card back into
            // view once React commits; `nearest` makes every other case a no-op.
            const willClose = open;
            setOpen((v) => !v);
            if (willClose) {
              requestAnimationFrame(() => rootRef.current?.scrollIntoView({ block: "nearest" }));
            }
          }}
          className={`ui-activity ${DISCLOSURE_HEADER_STICKY_CLASS} ${DISCLOSURE_HEADER_ROW_CLASS}`}
          data-slot="head"
          data-kind="event"
          data-state={activityState(state)}
        >
          {header}
        </button>
      ) : (
        <div
          className="ui-activity flex w-full items-center gap-2 bg-surface-muted px-3 py-2 text-left"
          data-slot="head"
          data-kind="event"
          data-state={activityState(state)}
        >
          {header}
        </div>
      )}
      {expandable && open && rows !== undefined && (
        <div
          data-slot="body"
          className="ui-tree anim-fade divide-y divide-line-muted border-t border-line"
        >
          {rows.map((row, index) => (
            <div
              key={row.key}
              data-depth="1"
              data-last={index === rows.length - 1 ? "true" : undefined}
            >
              {row.content}
            </div>
          ))}
        </div>
      )}
      {expandable && open && rows === undefined && (
        <div data-slot="body" className="anim-fade">
          {children}
        </div>
      )}
    </div>
  );
}
