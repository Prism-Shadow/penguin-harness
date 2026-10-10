/**
 * The collapsible one-liner: a full-width row — status icon, label, optional trailing detail,
 * chevron — that expands to a caller-styled body, or, with no body, the same line held still.
 * It is the one row of the transcript's activity family: a thinking step, a tool call, a
 * compaction's sections and an MCP connection's servers are each one, and an `ActivityGroup` (the
 * card) holds them under its head. So their width, padding, both colour states, the chevron
 * interaction and the anatomy a theme's recipe reads cannot drift apart. The card's head reads
 * the header constants below, and the pieces both draw (the mark, the progress slot, the
 * chevron) are the small components at the end of this module.
 *
 * The body folds through `Fold`, the same fold the card's own body uses, so a row inside an open
 * card opens and closes under the theme's layout motion rather than in one frame. The fold is
 * the `body` slot (its track is the row's sibling, where a recipe's `~ [data-slot="body"]` finds
 * it); the row's parts sit in the box inside the track. A row that mounts open is settled and
 * moves nothing, and text streaming into an open body grows it without a tween, since only the
 * track's value transitions.
 */
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { useUiStrings } from "../../../strings";
import { Chevron } from "../../icons/chevron/chevron";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import type { RunState } from "../../icons/status-icon/status-icon";
import { Fold } from "../fold/fold";

/**
 * The row itself (collapsed and expanded share it; the hover fill is the "open or close me"
 * affordance).
 */
export const DISCLOSURE_ROW_CLASS =
  "flex w-full items-center gap-2 bg-surface px-3 py-1.5 text-left transition-colors duration-150 hover:bg-surface-muted";

/**
 * Stacked-sticky positioning for rows inside an activity group: while a row's expanded body
 * scrolls, the row pins right below the stuck group head (top-4 = the head's -top-4 offset plus
 * its 2rem height).
 */
export const DISCLOSURE_ROW_STICKY_CLASS = "sticky top-4 z-[4]";

/**
 * The row's text label, minus the state's ink the row appends: the muted ink, the danger ink
 * when the step failed, so a failure is said by the words as well as by the icon.
 */
export const DISCLOSURE_LABEL_CLASS = "shrink-0 text-xs";

/**
 * The layout every activity head shares — an activity group's head, a one-line note: one line of
 * parts on the head's padding. The fill and the width are the host's.
 */
export const ACTIVITY_HEAD_CLASS = "flex items-center gap-2 px-3 py-2 text-left";

/** A head that does something answers the pointer with the stronger fill of the muted ground. */
export const ACTIVITY_HEAD_HOVER_CLASS = "transition-colors duration-150 hover:bg-line-muted";

/**
 * The header-family row — an activity group's head, the "Running / Done" summary bar of the
 * agent's work and the title bar of a harness event: a muted ground, taller padding, a stronger
 * hover.
 */
export const DISCLOSURE_HEADER_ROW_CLASS = `w-full bg-surface-muted ${ACTIVITY_HEAD_CLASS} ${ACTIVITY_HEAD_HOVER_CLASS}`;

/** Header-level sticky positioning: pins against the message list's scrollport, one z level above the nested rows. */
export const DISCLOSURE_HEADER_STICKY_CLASS = "sticky -top-4 z-[5]";

/**
 * The header-family title, minus the state-dependent ink the caller appends. Sentence case on
 * the small rung: a theme that sets work steps as a transcript uppercases them through the
 * activity hook, never the component.
 */
export const DISCLOSURE_HEADER_TITLE_CLASS = "shrink-0 text-xs font-semibold";

/**
 * The expanded plain-text body, the tool cards' output styling (an exec_command's expanded
 * output): a ruled, mono-sized `<pre>` block under its row — without its height cap.
 */
export const DISCLOSURE_OUTPUT_CLASS =
  "whitespace-pre-wrap border-t border-line-muted px-3 py-2 text-xs leading-5 text-fg-muted";

/**
 * The output block's height cap: 18rem, scrolling inside. An output that streams takes it only
 * once settled (`StreamText`'s `settledClassName`): while it streams it grows with the
 * transcript, as replies and thinking do, since a nested scrollbox would carry the theme's veil
 * and caret off with its first screen and strand the live tail the transcript follows.
 */
export const DISCLOSURE_OUTPUT_CAP_CLASS = "max-h-72 overflow-auto";

/** A settled output block: the block with its cap (a harness note's report, a finished task's output). */
export const DISCLOSURE_OUTPUT_PRE_CLASS = `${DISCLOSURE_OUTPUT_CAP_CLASS} ${DISCLOSURE_OUTPUT_CLASS}`;

/**
 * The expanded Markdown body — the thinking and compaction sections. The block the output body
 * wears, minus the parts that only fit command output: full-bleed under its row, separated by
 * the same divider and inset by the same padding, so it reads as another kind of output rather
 * than as a quotation inset inside the card.
 *
 * It keeps prose type rather than the output block's: the output block is monospace, and the
 * app's sans at that size reads visibly smaller beside it. `leading-relaxed` is within a hair of
 * the prose paragraphs' own line height, so paragraphs, list items and headings land on one
 * rhythm. `md-body-flush` drops the outermost block's margin at each end, so the body's own
 * `py-2` is the whole gap. It is a rule in the prose stylesheet (`prose.css`), not a
 * `[&>*:first-child]:mt-0` utility here: the `.md-body` margins it has to beat are unlayered, and
 * an unlayered declaration wins over `@layer utilities` at any specificity.
 *
 * No `whitespace-pre-wrap` (these bodies are prose) and no height cap: both bodies stream (through
 * `StreamText`), and a nested scrollbox would strand the live tail the transcript's own follow
 * scrolls to.
 */
export const DISCLOSURE_BODY_MD_CLASS =
  "md-body md-body-flush border-t border-line-muted px-3 py-2 text-sm leading-relaxed text-fg-muted";

/**
 * The card a group of rows sits in — an activity group's chrome. It clips rather than hides its
 * overflow: an overflow-hidden ancestor would become the sticky head's scroll container, and the
 * head would stick to the card instead of the transcript. Clipping keeps the rounded corners
 * without that.
 */
export const DISCLOSURE_CARD_CLASS =
  "anim-msg my-2 overflow-clip rounded-md border border-line bg-surface";

/**
 * What a transcript row is and where it stands, for the `ui-activity` hook: a step of the agent's
 * work (the thinking and tool rows, the work group's head) or an `event`, something the harness
 * did or injected (a compaction and its sections, an MCP connection and its servers, a background
 * task settling, an injected message, a trigger, a handoff), so a theme can render every one of
 * them its own way (a sweep while running, a transcript line).
 */
export type ActivityKind = "thinking" | "tool" | "event";

export interface ActivityMark {
  kind: ActivityKind;
  state: "running" | "done" | "error";
}

/**
 * The run states the status icon shows, folded onto the three the activity hook knows. Waiting
 * on an approval is unfinished work, so it reads as running; a stopped step is settled.
 */
export function activityState(state: RunState): ActivityMark["state"] {
  if (state === "failed") return "error";
  return state === "running" || state === "waiting" ? "running" : "done";
}

/**
 * The activity hook's mark slot, the row's leading mark: a status icon, or a mark naming an event
 * — a registry glyph's path, drawn in the subtle ink, or a node of the caller's.
 */
export function ActivityMarkSlot({ mark }: { mark: ReactNode }) {
  return (
    <span data-slot="mark" className="flex shrink-0">
      {typeof mark === "string" ? <GlyphIcon d={mark} className="text-fg-subtle" /> : mark}
    </span>
  );
}

/**
 * The activity hook's progress slot, rendered only while the step is actually executing (not
 * while it waits on an approval), empty and `hidden`: the default theme draws no bar, and a
 * hidden node leaves no gap in the row's flex spacing, so a theme that draws one sets its own
 * `display`.
 */
export function ActivityProgress({ running }: { running: boolean }) {
  return running ? <span data-slot="progress" aria-hidden className="hidden" /> : null;
}

/**
 * The activity hook's toggle slot, the fold's chevron after the words. `order-last` carries it
 * past the row's spacer to the far edge unless a theme's recipe keeps it beside them; `hidden`,
 * it stands in for a chevron button at the row's end (`toggle-end`), and only a theme that keeps
 * the chevron beside the words shows it.
 */
export function ActivityToggle({ open, hidden = false }: { open: boolean; hidden?: boolean }) {
  return (
    <span
      data-slot="toggle"
      {...(hidden ? { "aria-hidden": true } : {})}
      className={hidden ? "hidden shrink-0" : "order-last flex shrink-0"}
    >
      <Chevron open={open} className="text-fg-subtle" />
    </span>
  );
}

/** The far end of a row that holds more than its own button. */
export interface DisclosureRowEnd {
  /** Parts outside the row's button (a marker, an action): a button cannot hold another. */
  parts?: ReactNode;
  /** The end chevron's name while collapsed; the interface's word for "expand" by default. */
  expandLabel?: string;
  /** The end chevron's name while expanded; the interface's word for "collapse" by default. */
  collapseLabel?: string;
}

export interface DisclosureRowProps {
  /** The leading status icon slot (a StatusIcon, matching the thinking and tool rows). */
  icon: ReactNode;
  /**
   * The row's one-line label, a fixed phrase ("Thinking"). A theme may recase it, so a row that
   * names something (an MCP server) leaves it out and sets the name in `trailing` as a detail.
   */
  label?: string;
  /** The row's words after the mark and the label (a duration, a failure tag, a tool's name). */
  trailing?: ReactNode;
  /** Pins the row below the stuck group head while its body scrolls. */
  sticky?: boolean;
  defaultOpen?: boolean;
  /** A row of the transcript's work or a harness event: the row carries the `ui-activity` hook with this mark. */
  activity?: ActivityMark;
  /**
   * The step is executing right now, so the progress slot shows; by default whenever the
   * activity runs. A step waiting on an approval runs but is not in flight.
   */
  inFlight?: boolean;
  /**
   * The row holds parts after its own button: the row becomes a line holding that button, the
   * parts, and the chevron as a second button after them, named for what pressing it does. A
   * row that opens only.
   */
  end?: DisclosureRowEnd;
  /** Shown under the row whatever its collapsed state, before the body (a call's approval). A row that opens only. */
  under?: ReactNode;
  /**
   * The expanded body; the caller styles it (a Markdown body, an output `<pre>`, …), and the row
   * folds it in the `body` slot so a theme can treat every row's body alike. It is mounted only
   * while open or folding closed, so a streaming body that the reader has not opened costs
   * nothing. Without one the row is a static line — no button, no chevron, no hover — so a list
   * mixing rows that open with rows that have nothing to show keeps one column.
   */
  children?: ReactNode;
}

export function DisclosureRow({
  icon,
  label,
  trailing,
  sticky = false,
  defaultOpen = false,
  activity,
  inFlight,
  end,
  under,
  children,
}: DisclosureRowProps) {
  const strings = useUiStrings();
  const [open, setOpen] = useState(defaultOpen);
  const rootRef = useRef<HTMLDivElement>(null);
  /** The reader closed the row: land the view on it once the fold has finished. */
  const landOnClose = useRef(false);
  const ink = activity?.state === "error" ? "text-tone-danger-fg" : "text-fg-muted";
  const parts = (
    <>
      {icon !== undefined && <ActivityMarkSlot mark={icon} />}
      {label !== undefined && (
        <span
          className={`${DISCLOSURE_LABEL_CLASS} ${ink}`}
          {...(activity ? { "data-slot": "label" } : {})}
        >
          {label}
        </span>
      )}
      {trailing}
      {activity && <ActivityProgress running={inFlight ?? activity.state === "running"} />}
    </>
  );
  if (children === undefined || children === null) {
    return (
      <div
        className={`${activity ? "ui-activity " : ""}flex w-full items-center gap-2 bg-surface px-3 py-1.5 text-left`}
        data-kind={activity?.kind}
        data-state={activity?.state}
      >
        {parts}
        <span className="min-w-0 flex-1" />
      </div>
    );
  }
  const rowClass = `${activity ? "ui-activity " : ""}${sticky ? `${DISCLOSURE_ROW_STICKY_CLASS} ` : ""}${DISCLOSURE_ROW_CLASS}`;
  const toggle = (): void => {
    // Collapsing while the row is stuck: its real top sits above the fold, so once the body has
    // folded away land the view back on the row (`nearest` does not move for an expand or an
    // in-view collapse). It waits for the fold's end rather than a frame, since while the body
    // is still folding the row is still stuck and the view would land on the wrong place.
    landOnClose.current = open;
    setOpen((v) => !v);
  };
  return (
    <div ref={rootRef}>
      {end === undefined ? (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className={rowClass}
          data-kind={activity?.kind}
          data-state={activity?.state}
        >
          {parts}
          <ActivityToggle open={open} />
          <span className="min-w-0 flex-1" />
        </button>
      ) : (
        // Two buttons, one disclosure: the row's words, and the chevron at its far end past the
        // parts that cannot sit inside a button.
        <div className={rowClass} data-kind={activity?.kind} data-state={activity?.state}>
          <button
            type="button"
            aria-expanded={open}
            onClick={toggle}
            className="flex min-w-0 flex-1 items-center gap-2 self-stretch text-left"
          >
            {parts}
            <ActivityToggle open={open} hidden />
            <span className="min-w-0 flex-1" />
          </button>
          {end.parts}
          {/* Named for what it does, like every chevron toggle: naming it after the row would
              give the row two buttons under one name. */}
          <button
            type="button"
            aria-expanded={open}
            aria-label={
              open ? (end.collapseLabel ?? strings.collapse) : (end.expandLabel ?? strings.expand)
            }
            onClick={toggle}
            data-slot="toggle-end"
            className="flex shrink-0 items-center self-stretch"
          >
            <Chevron open={open} className="text-fg-subtle" />
          </button>
        </div>
      )}
      {under !== undefined && <div data-slot="under">{under}</div>}
      <Fold
        open={open}
        data-slot="body"
        onClosed={() => {
          if (!landOnClose.current) return;
          landOnClose.current = false;
          rootRef.current?.scrollIntoView({ block: "nearest" });
        }}
      >
        {children}
      </Fold>
    </div>
  );
}
