/**
 * The transcript's process banner (an MCP connection, a compaction): the work group's header
 * anatomy on a card of its own — the same card, the same sticky title bar (status icon, short
 * title, one-line detail, duration, chevron at the far right), so running, success and failure
 * are one row with only the icon and the detail changing. The duration follows the detail the
 * way the work group's count and duration do: the live clock while running, the settled span
 * once finished. A body makes the row expandable; collapsing while the stuck header sits above
 * the fold scrolls the card back into view.
 *
 * Expand policy, the work group's: the body opens while the step runs, so its rows are visible
 * as they are appended, and closes itself once the step settles, leaving the one-line summary
 * the row exists to be. The body's own rows never open with it. Once the reader toggles it, the
 * row is theirs: a later automatic change never fights them.
 *
 * The title is sentence case on the small rung, like the work group's; a banner is not a step
 * of the agent's work, so it carries no activity hook.
 */
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Chevron } from "../../icons/chevron/chevron";
import { StatusIcon } from "../../icons/status-icon/status-icon";
import type { RunState } from "../../icons/status-icon/status-icon";
import { DurationSlot } from "../../feedback/duration-slot/duration-slot";
import {
  DISCLOSURE_CARD_CLASS,
  DISCLOSURE_HEADER_ROW_CLASS,
  DISCLOSURE_HEADER_STICKY_CLASS,
  DISCLOSURE_HEADER_TITLE_CLASS,
} from "../../layout/disclosure-row/disclosure-row";

export interface StepBannerProps {
  state: RunState;
  /** The constant short label in the title slot. */
  title: string;
  /** One line of status or result; truncates, with the full text as its tooltip. */
  detail?: string;
  /** While running, a live clock ticks from this timestamp. */
  liveSinceMs?: number;
  /** The settled wall time, once finished. */
  durationMs?: number;
  /** The expandable body; its presence adds the chevron (open while running, closed once settled). */
  children?: ReactNode;
}

export function StepBanner({
  state,
  title,
  detail,
  liveSinceMs,
  durationMs,
  children,
}: StepBannerProps) {
  const running = state === "running";
  const [open, setOpen] = useState(running);
  const userToggled = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const expandable = children !== undefined && children !== null;

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
      <StatusIcon state={state} />
      <span
        className={`${DISCLOSURE_HEADER_TITLE_CLASS} ${running ? "text-tone-success-fg" : "text-fg-muted"}`}
      >
        {title}
      </span>
      {/* Detail then duration, left-aligned after the title; the trailing spacer pins the
          chevron to the right edge. min-w-0 (not flex-1) lets a long detail truncate while a
          short one keeps the duration snug against it. */}
      {detail !== undefined && (
        <span
          data-tooltip={detail}
          data-tooltip-content="code"
          className="min-w-0 truncate font-mono text-xs text-fg-subtle"
        >
          {detail}
        </span>
      )}
      {showDuration && (
        <DurationSlot running={running} sinceMs={liveSinceMs} durationMs={durationMs} />
      )}
      <span className="min-w-0 flex-1" />
      {expandable && <Chevron open={open} className="text-fg-subtle" />}
    </>
  );

  return (
    // The card clips rather than hides its overflow: the sticky header must stick to the
    // message list's scrollport, and an overflow-hidden ancestor would become its scroll
    // container instead.
    <div ref={rootRef} className={DISCLOSURE_CARD_CLASS}>
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
          className={`${DISCLOSURE_HEADER_STICKY_CLASS} ${DISCLOSURE_HEADER_ROW_CLASS}`}
        >
          {header}
        </button>
      ) : (
        <div className="flex w-full items-center gap-2 bg-surface-muted px-3 py-2 text-left">
          {header}
        </div>
      )}
      {expandable && open && (
        <div className="anim-fade divide-y divide-line-muted border-t border-line">{children}</div>
      )}
    </div>
  );
}
