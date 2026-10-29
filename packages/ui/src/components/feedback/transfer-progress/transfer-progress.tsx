/**
 * A transfer under way, said in one line of plain text: one sentence saying what is being
 * brought over and from where, the amount so far against the whole, and a short bar giving the
 * same reading — a conversation's history coming over from a machine, its older history syncing
 * behind it, a folded output being fetched.
 *
 * Not an alarm, not a status pill and not a button: no mark, the sentence in the muted ink, the
 * amount in the subtle ink in tabular figures, and only the bar's fill carries the accent — the
 * way the conversation's other notes read. The amount is the caller's text, and it keeps one
 * unit and one width for the whole transfer (the done figure padded to the total's), so nothing
 * on the line moves as the bytes count up. Before an amount is known the bar is indeterminate and
 * no amount shows.
 *
 * Two rungs, as the retry row has: `xs` in a transcript's line or a card's body, `sm` where it
 * stands alone in a pane. The bar is the progress bar's thinnest, at a fixed width after the
 * words, so the line keeps one height; in a column narrower than the line, the bar and the amount
 * wrap under the sentence.
 *
 * Props only: every word is the caller's.
 */
import { ProgressBar } from "../progress-bar/progress-bar";

export interface TransferProgressProps {
  /** What is being brought over, and from where, in one sentence. It also names the bar. */
  label: string;
  /**
   * The amount so far and the whole ("  3.2 / 9.6 MB"), in one unit, the done figure as wide as
   * the total's; null while nothing is counted yet.
   */
  amount?: string | null;
  /** How far along, in the transfer's own unit; with `max`. Omitted, the bar is indeterminate. */
  value?: number;
  max?: number;
  /** The type rung: `xs` in a transcript or a card, `sm` alone in a pane. */
  size?: "xs" | "sm";
  /** Placement only (a margin, `justify-center` under a centred heading). */
  className?: string;
}

const TEXT: Record<"xs" | "sm", string> = { xs: "text-xs", sm: "text-sm" };
const BAR_WIDTH: Record<"xs" | "sm", string> = { xs: "w-16", sm: "w-24" };

/** One line high and centred on it, whatever wraps beside it. */
const LINE_BOX = "inline-flex h-[1lh] shrink-0 items-center";

export function TransferProgress({
  label,
  amount = null,
  value,
  max,
  size = "xs",
  className = "",
}: TransferProgressProps) {
  const reading = value !== undefined && max !== undefined && max > 0 ? { value, max } : null;
  return (
    <div
      data-transfer=""
      className={`flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1 ${TEXT[size]} text-fg-muted ${className}`}
    >
      <span className="min-w-0 break-words">{label}</span>
      {amount !== null && (
        // Figure spaces pad the done figure; `whitespace-pre` keeps any ordinary space as well.
        <span className="shrink-0 whitespace-pre tabular-nums text-fg-subtle">{amount}</span>
      )}
      {/* The bar takes its width from this box: its own class asks for the full width. */}
      <span className={`${LINE_BOX} ${BAR_WIDTH[size]}`}>
        <ProgressBar size="xs" label={label} {...(reading ?? { indeterminate: true })} />
      </span>
    </div>
  );
}
