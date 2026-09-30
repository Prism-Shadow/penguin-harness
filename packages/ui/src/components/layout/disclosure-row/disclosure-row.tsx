/**
 * The collapsible one-liner: a full-width row — status icon, label, optional trailing detail,
 * chevron — that expands to a caller-styled body. Every disclosure row in the transcript
 * (thinking, compaction, the background completion notice) shares it, so their width, padding,
 * both colour states and the chevron interaction cannot drift apart. The tool cards and the work
 * group keep their own richer rows but read the same class constants below.
 */
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { Chevron } from "../../icons/chevron/chevron";
import type { RunState } from "../../icons/status-icon/status-icon";

/**
 * The row itself (collapsed and expanded share it; the hover fill is the "open or close me"
 * affordance).
 */
export const DISCLOSURE_ROW_CLASS =
  "flex w-full items-center gap-2 bg-surface px-3 py-1.5 text-left transition-colors duration-150 hover:bg-surface-muted";

/**
 * Stacked-sticky positioning for rows inside the work group: while a row's expanded body scrolls,
 * the row pins right below the stuck group header (top-4 = the header's -top-4 offset plus its
 * 2rem height). A standalone row (a single-row card) omits it.
 */
export const DISCLOSURE_ROW_STICKY_CLASS = "sticky top-4 z-[4]";

/** The row's text label. */
export const DISCLOSURE_LABEL_CLASS = "shrink-0 text-xs text-fg-muted";

/**
 * The header-family row — the work group's "Running / Done" summary bar: a muted ground, taller
 * padding, a stronger hover. A standalone disclosure that should read like a settled work group
 * (the background completion notice) uses this variant.
 */
export const DISCLOSURE_HEADER_ROW_CLASS =
  "flex w-full items-center gap-2 bg-surface-muted px-3 py-2 text-left transition-colors duration-150 hover:bg-line-muted";

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
 * output): a ruled, mono-sized `<pre>` block under its row.
 */
export const DISCLOSURE_OUTPUT_PRE_CLASS =
  "max-h-72 overflow-auto whitespace-pre-wrap border-t border-line-muted px-3 py-2 text-xs leading-5 text-fg-muted";

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
 * No `whitespace-pre-wrap` (these bodies are prose) and no height cap: both bodies stream, and a
 * nested scrollbox would strand the live tail the transcript's own follow scrolls to.
 */
export const DISCLOSURE_BODY_MD_CLASS =
  "md-body md-body-flush border-t border-line-muted px-3 py-2 text-sm leading-relaxed text-fg-muted";

/**
 * The card a row (or a group of rows) sits in — the work group's chrome. A standalone disclosure
 * row wraps itself in one so its width and framing match the neighbouring groups.
 */
export const DISCLOSURE_CARD_CLASS =
  "anim-msg my-2 overflow-clip rounded-md border border-line bg-surface";

/**
 * What a work step is and where it stands, for the `ui-activity` hook: the transcript's thinking
 * and tool rows and the work group's header carry it, so a theme can render work in progress its
 * own way (a glow while running, a transcript line with a block progress bar).
 */
export interface ActivityMark {
  kind: "thinking" | "tool";
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
 * The activity hook's progress slot, rendered only while the step is actually executing (not
 * while it waits on an approval), empty and `hidden`: the default theme draws no bar, and a
 * hidden node leaves no gap in the row's flex spacing, so a theme that draws one sets its own
 * `display`.
 */
export function ActivityProgress({ running }: { running: boolean }) {
  return running ? <span data-slot="progress" aria-hidden className="hidden" /> : null;
}

export function DisclosureRow({
  icon,
  label,
  trailing,
  variant = "row",
  sticky = false,
  defaultOpen = false,
  activity,
  children,
}: {
  /** The leading status icon slot (a StatusIcon, matching the thinking and tool rows). */
  icon: ReactNode;
  /** The row's one-line label. */
  label: string;
  /** Optional detail between the label and the spacer (a duration, a failure tag). */
  trailing?: ReactNode;
  /**
   * "row" = a line inside the work group (the thinking block's form); "header" = the work
   * group's own summary-bar form (the background notice's standalone card).
   */
  variant?: "row" | "header";
  /** Pins the row while its body scrolls: nested rows under the stuck group header, a header against the scrollport. */
  sticky?: boolean;
  defaultOpen?: boolean;
  /** A work step (the thinking row): the row carries the `ui-activity` hook with this mark. */
  activity?: ActivityMark;
  /** The expanded body; the caller styles it (a Markdown body, an output `<pre>`, …). */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const rootRef = useRef<HTMLDivElement>(null);
  const header = variant === "header";
  const rowClass = header ? DISCLOSURE_HEADER_ROW_CLASS : DISCLOSURE_ROW_CLASS;
  const stickyClass = header ? DISCLOSURE_HEADER_STICKY_CLASS : DISCLOSURE_ROW_STICKY_CLASS;
  const labelClass = header
    ? `${DISCLOSURE_HEADER_TITLE_CLASS} text-fg-muted`
    : DISCLOSURE_LABEL_CLASS;
  return (
    <div ref={rootRef}>
      <button
        type="button"
        onClick={() => {
          // Collapsing while the row is stuck: its real top sits above the fold, so land the
          // view back on the row (`nearest` does not move for an expand or an in-view collapse).
          const willClose = open;
          setOpen((v) => !v);
          if (willClose) {
            requestAnimationFrame(() => rootRef.current?.scrollIntoView({ block: "nearest" }));
          }
        }}
        aria-expanded={open}
        className={`${activity ? "ui-activity " : ""}${sticky ? `${stickyClass} ` : ""}${rowClass}`}
        data-kind={activity?.kind}
        data-state={activity?.state}
      >
        {icon !== undefined && (
          <span data-slot="mark" className="flex shrink-0">
            {icon}
          </span>
        )}
        <span className={labelClass} {...(activity ? { "data-slot": "label" } : {})}>
          {label}
        </span>
        {trailing}
        {activity && <ActivityProgress running={activity.state === "running"} />}
        {/* The chevron follows the words; `order-last` carries it past the spacer to the row's far
            edge unless a theme's recipe keeps it beside them. */}
        <span data-slot="toggle" className="order-last flex shrink-0">
          <Chevron open={open} className="text-fg-subtle" />
        </span>
        <span className="min-w-0 flex-1" />
      </button>
      {open && children}
    </div>
  );
}
