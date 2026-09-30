/**
 * The work group: a run of consecutive work steps (thinking rows, tool calls) folded under one
 * header, the transcript's "what the agent did" between two pieces of its reply.
 *
 * Expand policy, two layers deep: the group opens while it runs and closes itself once it is
 * done, and the rows inside it stay closed — the reader sees that a step happened and how long it
 * took, not its contents, until they ask. A manual toggle is respected from then on. A step
 * waiting on an approval forces the body open, since the approval buttons live in it.
 *
 * The header is a title bar of its own (the muted ground, a short title that doubles as the
 * state), a different layer from the rows on the surface below it, so the parent and its
 * children read apart. It is sticky against the transcript's scrollport, so a long open group can
 * be collapsed from anywhere inside it; this is the first of two stacked sticky levels, the row
 * being read pinning right below it. Collapsing while the header is stuck lands the view back on
 * the group.
 *
 * The duration is the span of the steps (the earliest start to the latest end), reconstructible
 * from the steps' own timestamps: while a step is in flight its end is not known, so a live clock
 * extends the span to now; with nothing in flight the value is the settled span. A group that
 * merely stays open between steps does not tick, or the number would climb past the span and
 * snap back when the group settles.
 *
 * Three hooks: the card is a frame (its header the head, its rows the body), the header is a
 * step of the agent's work (thinking only, or tool work), and the rows hang off the header one
 * level down as a tree, so a theme may join them to it with connector rules instead of the box.
 * Each row is wrapped rather than marked on its own root, because a step also renders outside a
 * group.
 */
import { useEffect, useRef, useState } from "react";
import type { Key, ReactNode } from "react";
import { Chevron } from "../../icons/chevron/chevron";
import { StatusIcon } from "../../icons/status-icon/status-icon";
import { DurationSlot } from "../../feedback/duration-slot/duration-slot";
import {
  ActivityProgress,
  DISCLOSURE_CARD_CLASS,
  DISCLOSURE_HEADER_ROW_CLASS,
  DISCLOSURE_HEADER_STICKY_CLASS,
  DISCLOSURE_HEADER_TITLE_CLASS,
} from "../../layout/disclosure-row/disclosure-row";
import type { ActivityMark } from "../../layout/disclosure-row/disclosure-row";

/** One step in the group, keyed for React. */
export interface WorkGroupRow {
  key: Key;
  content: ReactNode;
}

export interface WorkGroupProps {
  /**
   * The group's state: running while the model may still add a step (the caller decides — a
   * trailing group of a running task counts), done once it cannot. The body follows it until the
   * reader toggles the group.
   */
  running: boolean;
  /** A step is in flight right now: the duration ticks and the progress slot shows. */
  stepRunning: boolean;
  /** What the header's activity mark names: thinking only, or tool work. */
  kind: ActivityMark["kind"];
  /** The header's title, which doubles as its state ("Running", "Done"). */
  title: string;
  /** The step count as words ("3 steps"); omitted for a group of thinking only. Hidden below `sm`. */
  count?: string;
  /** When the earliest step started: the live clock's origin while a step is in flight. */
  startMs?: number;
  /** The settled span, shown once nothing is in flight. */
  durationMs?: number;
  /** A step waits on an approval: the body is forced open. */
  pending?: boolean;
  rows: readonly WorkGroupRow[];
}

export function WorkGroup({
  running,
  stepRunning,
  kind,
  title,
  count,
  startMs,
  durationMs,
  pending = false,
  rows,
}: WorkGroupProps) {
  const [open, setOpen] = useState(running);
  const userToggled = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Before any manual toggle, follow the header's own state: open while the group works, closed
  // the moment it is done. The caller's `running` bridges the gaps between two steps, so the
  // group closes once and stays closed rather than flickering on every step.
  useEffect(() => {
    if (!userToggled.current) setOpen(running);
  }, [running]);

  const shown = open || pending;
  const showDuration = stepRunning
    ? startMs !== undefined
    : durationMs !== undefined && durationMs > 0;

  return (
    // The card clips rather than hides its overflow: an overflow-hidden ancestor would become the
    // sticky header's scroll container, and the header would stick to the card instead of the
    // transcript. Clipping keeps the rounded corners without that.
    <div ref={rootRef} className={`ui-frame ${DISCLOSURE_CARD_CLASS}`}>
      <button
        type="button"
        data-group-header
        aria-expanded={shown}
        onClick={() => {
          userToggled.current = true;
          // Collapsing while the header is stuck: the group's top sits above the fold, so bring
          // the (now header-only) group back into view once React commits. A forced-open group
          // keeps its body, so that click moves nothing.
          const willClose = open && !pending;
          setOpen((v) => !v);
          if (willClose) {
            requestAnimationFrame(() => rootRef.current?.scrollIntoView({ block: "nearest" }));
          }
        }}
        className={`ui-activity ${DISCLOSURE_HEADER_STICKY_CLASS} ${DISCLOSURE_HEADER_ROW_CLASS}`}
        data-slot="head"
        data-kind={kind}
        data-state={running ? "running" : "done"}
      >
        <StatusIcon state={running ? "running" : "done"} />
        <span
          data-slot="label"
          className={`${DISCLOSURE_HEADER_TITLE_CLASS} ${running ? "text-tone-success-fg" : "text-fg-muted"}`}
        >
          {title}
        </span>
        {/* Below sm the count goes: the header must stay one uncut line on a phone. */}
        {count !== undefined && (
          <span
            data-slot="detail"
            className="hidden shrink-0 font-mono text-xs text-fg-subtle sm:inline"
          >
            {count}
          </span>
        )}
        {showDuration && (
          <DurationSlot
            data-slot="detail"
            running={stepRunning}
            sinceMs={startMs}
            durationMs={durationMs}
          />
        )}
        <ActivityProgress running={stepRunning} />
        <span className="min-w-0 flex-1" />
        <Chevron open={shown} className="text-fg-subtle" />
      </button>
      {shown && (
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
    </div>
  );
}
