/**
 * A one-line harness note: something the harness did or attached, said in one line with nothing
 * to open — the schedule or the company trigger that started a run, the skills a message
 * invoked, the files it carried, the conversation it was handed off from — and the goal
 * plugin's status line over the composer. It is the one-line sibling of `StepBanner`, on the
 * same anatomy: a frame whose only child is its head, an activity row of the `event` kind,
 * settled. So each theme draws a note the way it draws a settled work group's header: Primer a
 * grey pill at its content's width, Frost a lineless line with the soft rounded hover, Console a
 * transcript line with no box, its label on the small mono rung, uppercased, tracked and muted.
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
 * words and the work group header's hover; it is named by the note as one sentence when the
 * caller gives one, since a phrase and a name read side by side are not always one, and the
 * hint is a tooltip only. A subject that may run long (`truncate`) is cut to the line, its whole
 * text kept as the tooltip, and the line never wraps; otherwise the parts wrap onto a second
 * line in a narrow column rather than overflow it.
 *
 * The box carries no margin and no motion of its own: where it sits (the transcript's spacing,
 * a user row's column, a steer's chip) decides both, through `className`.
 */
import type { ReactNode } from "react";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";

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
  action?: { onClick: () => void; hint?: string; name?: string };
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
      {mark !== undefined && mark !== null && (
        <span data-slot="mark" className="flex shrink-0">
          {typeof mark === "string" ? <GlyphIcon d={mark} className="text-fg-subtle" /> : mark}
        </span>
      )}
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
  // The fill is the box's and the head's corners follow it, so a hover tints the whole pill; a
  // theme that takes the box away paints the head itself. The box does not clip, so the focus
  // ring drawn round a head that is a button stays whole.
  const head = `ui-activity flex min-w-0 flex-1 items-center gap-2 rounded-[inherit] px-3 py-2 text-left text-xs text-fg-muted ${
    truncate ? "" : "flex-wrap"
  }`;
  return (
    <div
      className={`ui-frame flex ${fill ? "w-full" : "w-fit max-w-full"} rounded-md border border-line bg-surface-muted ${className}`}
    >
      {action !== undefined ? (
        <button
          type="button"
          aria-label={action.name}
          data-tooltip={action.hint}
          onClick={action.onClick}
          className={`${head} transition-colors duration-150 hover:bg-line-muted hover:text-fg`}
          data-slot="head"
          data-kind="event"
          data-state="done"
        >
          {parts}
        </button>
      ) : (
        <p className={head} data-slot="head" data-kind="event" data-state="done">
          {parts}
        </p>
      )}
    </div>
  );
}
