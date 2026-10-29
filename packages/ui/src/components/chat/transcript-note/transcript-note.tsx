/**
 * A one-line harness note: something the harness did or attached, said in one line with nothing
 * to open — the schedule or the company trigger that started a run, the skills a message
 * invoked, the files it carried, the conversation it was handed off from — and the goal
 * plugin's status line over the composer. It is the one-line sibling of `ActivityGroup`, on the
 * same anatomy and built from the same head pieces (the mark slot, the head's layout and its
 * hover): a frame whose only child is its head, an activity row of the `event` kind, settled. So
 * each theme draws a note the way it draws a settled activity card's head: Primer a grey pill at
 * its content's width, Frost a lineless line of words, Console a transcript line with no box, its
 * label on the small mono rung, uppercased, tracked and muted.
 *
 * The label is a fixed phrase and never holds a name: a theme may recase the label, and a file,
 * an agent, a task or a person's objective must read as written. The names go in the subject.
 * The parts, in order: the mark (a registry glyph in the subtle ink, or a node), the label (what
 * happened), the subject (the names it happened to, in the label's own ink), a tag naming its
 * kind (a `Badge`), an identifier it names (mono in the body ink), trailing facts in the subtle
 * ink (a time, a budget, a progress line), and a part at the far end (a state tag). Everything
 * past the label that is text is a detail to the activity hook; the tags keep their own ink.
 *
 * A note that leads somewhere (`action`) is a button, the whole line, with an arrow after its
 * words and the activity head's hover; it is named by the note as one sentence when the
 * caller gives one, since a phrase and a name read side by side are not always one, and the
 * hint is a tooltip only. A subject that may run long (`truncate`) is cut to the line, its whole
 * text kept as the tooltip, and the line never wraps; otherwise the parts wrap onto a second
 * line in a narrow column rather than overflow it.
 *
 * The box carries no margin and no motion of its own: where it sits (the transcript's spacing,
 * a user row's column, a steer's chip) decides both, through `className`.
 */
import type { HTMLAttributes, ReactNode } from "react";
import {
  ACTIVITY_HEAD_CLASS,
  ACTIVITY_HEAD_HOVER_CLASS,
  ActivityMarkSlot,
} from "../../layout/disclosure-row/disclosure-row";

/** Where a note leads: the whole line is then a button. */
export interface TranscriptNoteAction {
  onClick: () => void;
  /** The hover hint: where the note leads, which its words do not say. */
  hint?: string;
  /** The button's accessible name, the note as one sentence. */
  name?: string;
}

export interface TranscriptNoteFrameProps {
  /** The head's run state as the activity hook knows it: running while something is live. */
  state?: "running" | "done";
  /** `fit`: the box takes its content's width; `fill`: the column's. */
  width?: "fit" | "fill";
  /** The head's parts wrap onto a second line in a narrow column; off when a part does its own. */
  wrap?: boolean;
  /** The note leads somewhere: its head is one button. */
  action?: TranscriptNoteAction;
  /** Placement only: the margin and the entrance motion. */
  className?: string;
  /** The box's own attributes: a role, a `data-*` naming what the note is. */
  attributes?: HTMLAttributes<HTMLDivElement> & { [data: `data-${string}`]: string | undefined };
  /** The head's parts, in order. */
  children: ReactNode;
}

/**
 * The note's box and its one head, an activity row of the `event` kind on the small rung in the
 * muted ink: the one place the note's hooks are written. The note renders through it, and so does
 * any other one-line row that stands between a conversation's messages (the retry row's `note`
 * frame), so the transcript has one note shape.
 *
 * The fill is the box's and the head's corners follow it, so a hover tints the whole pill; a
 * theme that takes the box away paints the head itself. The box does not clip, so the focus ring
 * drawn round a head that is a button stays whole.
 */
export function TranscriptNoteFrame({
  state = "done",
  width = "fit",
  wrap = true,
  action,
  className = "",
  attributes,
  children,
}: TranscriptNoteFrameProps) {
  const head = `ui-activity ${ACTIVITY_HEAD_CLASS} min-w-0 flex-1 rounded-[inherit] text-xs text-fg-muted${
    wrap ? " flex-wrap" : ""
  }`;
  return (
    <div
      {...attributes}
      className={`ui-frame flex ${width === "fill" ? "w-full" : "w-fit max-w-full"} rounded-md border border-line bg-surface-muted ${className}`}
    >
      {action !== undefined ? (
        <button
          type="button"
          aria-label={action.name}
          data-tooltip={action.hint}
          // Where the note leads (the conversation it goes back to) is not in its words.
          data-tooltip-extra
          onClick={action.onClick}
          className={`${head} ${ACTIVITY_HEAD_HOVER_CLASS} hover:text-fg`}
          data-slot="head"
          data-kind="event"
          data-state={state}
        >
          {children}
        </button>
      ) : (
        <p className={head} data-slot="head" data-kind="event" data-state={state}>
          {children}
        </p>
      )}
    </div>
  );
}

export interface TranscriptNoteProps {
  /** The leading mark: a registry glyph's path, drawn in the subtle ink, or a node of the caller's. */
  mark?: string | ReactNode;
  /** What happened, as a fixed phrase: never a name, since a theme may recase it. */
  label: string;
  /** The names the phrase is about (a task, an organization, skills, files, an agent, an objective). */
  subject?: string;
  /** The subject may run past the line: it is cut to fit, with its whole text as its tooltip. */
  truncate?: boolean;
  /** A tag after the subject naming the event's kind (a `Badge`). */
  tag?: ReactNode;
  /** An identifier the event names (a ticket, an event id), set in the mono face in the body ink. */
  code?: string;
  /** Trailing facts in the subtle ink, in order (a time, a budget, a progress line); empty ones are skipped. */
  meta?: readonly (string | null | undefined)[];
  /** A part at the line's far end (a state tag). */
  end?: ReactNode;
  /** `fit`: the box takes its content's width; `fill`: the column's, the subject taking the room. */
  width?: "fit" | "fill";
  /**
   * The note leads somewhere: the line becomes a button, with an arrow after its words. `name` is
   * the button's accessible name, the note as one sentence.
   */
  action?: TranscriptNoteAction;
  /** Placement only: the margin and the entrance motion. */
  className?: string;
}

export function TranscriptNote({
  mark,
  label,
  subject,
  truncate = false,
  tag,
  code,
  meta = [],
  end,
  width = "fit",
  action,
  className = "",
}: TranscriptNoteProps) {
  const fill = width === "fill";
  const parts = (
    <>
      {mark !== undefined && mark !== null && <ActivityMarkSlot mark={mark} />}
      <span data-slot="label" className="shrink-0">
        {label}
      </span>
      {subject !== undefined && (
        <span
          data-slot="detail"
          {...(truncate ? { "data-tooltip": subject, "data-tooltip-content": "text" } : {})}
          className={`${truncate ? "min-w-0 truncate" : ""}${fill ? " flex-1" : ""}`}
        >
          {subject}
        </span>
      )}
      {tag}
      {code !== undefined && (
        <span data-slot="detail" className="font-mono text-fg">
          {code}
        </span>
      )}
      {meta.map((fact, i) =>
        fact ? (
          <span key={i} data-slot="detail" className="shrink-0 text-fg-subtle">
            {fact}
          </span>
        ) : null,
      )}
      {end}
      {action !== undefined && (
        <span aria-hidden className="shrink-0 text-fg-subtle">
          →
        </span>
      )}
    </>
  );
  // A truncating subject keeps the line whole; otherwise the parts wrap in a narrow column.
  return (
    <TranscriptNoteFrame
      width={width}
      wrap={!truncate}
      {...(action !== undefined ? { action } : {})}
      className={className}
    >
      {parts}
    </TranscriptNoteFrame>
  );
}
