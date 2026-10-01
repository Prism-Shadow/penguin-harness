/**
 * A run's state as one glyph — a tool call, a thinking row, a work group, a banner: the spinner
 * while it runs, a static glyph once it waits or settles, so "still running" and "done" are told
 * apart at a glance without reading the text beside it.
 *
 * The ink says how much the state asks of the reader: live work in the busy ink, a wait in the
 * attention ink, a failure in the danger ink, and a finished or deliberately stopped run in the
 * subtle ink, receding. A stop is settled and expected, so it recedes like "done" rather than
 * flagging danger; its square is what tells the two apart.
 *
 * The icon carries no text of its own. With `label` it names itself (and shows the label as its
 * tooltip); without one it is decoration beside words that already say the state, and hidden
 * from assistive technology — an unnamed image would be announced as an anonymous one.
 */
import { ICONS } from "../icons";
import { Spinner } from "../spinner/spinner";

export type RunState = "running" | "waiting" | "done" | "failed" | "stopped";

/** The spinner's rungs, so a running row and a settled one occupy the same box. */
const SIZES = { xs: 10, sm: 12, md: 14 } as const;

export type StatusIconSize = keyof typeof SIZES;

const GLYPH: Record<Exclude<RunState, "running">, string> = {
  waiting: ICONS.hourglass,
  done: ICONS.checkCircle,
  failed: ICONS.xCircle,
  stopped: ICONS.stopCircle,
};

const INK: Record<Exclude<RunState, "running">, string> = {
  waiting: "text-tone-attention-fg",
  done: "text-fg-subtle",
  failed: "text-tone-danger-fg",
  stopped: "text-fg-subtle",
};

export function StatusIcon({
  state,
  size = "md",
  label,
}: {
  state: RunState;
  size?: StatusIconSize;
  /** Names the state for assistive technology and the tooltip; omit it beside a text label. */
  label?: string;
}) {
  if (state === "running") {
    // The spinner always announces itself; beside words that already say "running" it is hidden
    // with its wrapper instead, which is the same silence the settled glyphs keep.
    return (
      <span
        {...(label === undefined ? { "aria-hidden": true } : { "data-tooltip": label })}
        className="flex shrink-0"
      >
        <Spinner size={size} tone="success" label={label ?? ""} />
      </span>
    );
  }
  const px = SIZES[size];
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      // A style, not the attribute: an SVG presentation attribute cannot read a custom property.
      style={{ strokeWidth: "var(--ui-icon-stroke, 1.7)" }}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(label === undefined
        ? { "aria-hidden": true }
        : { role: "img" as const, "aria-label": label, "data-tooltip": label })}
      className={`block shrink-0 ${INK[state]}`}
    >
      <path d={GLYPH[state]} />
    </svg>
  );
}
