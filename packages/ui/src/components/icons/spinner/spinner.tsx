/**
 * The one spinner (K-redesign §3 rule 11, §5.1).
 *
 * Every busy indicator is this component: an arc on a track, centred in its own viewBox so the
 * rotation cannot wobble, at three sizes. It lives here because the guard lets `animate-spin`
 * appear in this file and nowhere else — thirteen hand-rolled rings at 2.5 / 3 / 3.5 px with
 * 1 / 1.5 / 2 px borders are what that rule exists to prevent coming back.
 *
 * The rotation is drawn once and re-timed by the theme: `.ui-live[data-live="spinner"]` keeps it
 * linear in Primer and Frost and steps it eight times a turn in Console, without either theme
 * redrawing the arc.
 *
 * Arriving ahead of the rest of W1's component set because the screens need it now; its
 * `spinner.demo.tsx` lands with that set (the gallery reaches a demo through a module's parts,
 * and the modules are written on the same PR as the demos).
 */
import type { ToneName } from "../../../tokens";

/** Pixel sizes, the icon-scale convention: a spinner never scales with the root font tier. */
const SIZES = { xs: 10, sm: 12, md: 14 } as const;

const TONE_INK: Record<ToneName, string> = {
  success: "text-tone-success-fg",
  attention: "text-tone-attention-fg",
  danger: "text-tone-danger-fg",
  done: "text-tone-done-fg",
  neutral: "text-tone-neutral-fg",
  info: "text-tone-info-fg",
};

/** The arc's share of the circle: a quarter reads as motion without becoming a ring. */
const ARC = 0.28;
const RADIUS = 7;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function Spinner({
  size = "md",
  tone = "inherit",
  label,
  className = "",
}: {
  size?: keyof typeof SIZES;
  /** `inherit` takes the ink around it, which is how a tone-coloured row stays one colour. */
  tone?: ToneName | "inherit";
  /** What is running. Announced, never drawn — the word beside a spinner is the caller's. */
  label: string;
  className?: string;
}) {
  const px = SIZES[size];
  return (
    <svg
      role="status"
      aria-label={label}
      data-live="spinner"
      width={px}
      height={px}
      viewBox="0 0 20 20"
      fill="none"
      className={`ui-live block shrink-0 animate-spin ${tone === "inherit" ? "" : TONE_INK[tone]} ${className}`}
      style={{ transformOrigin: "center" }}
    >
      <circle cx="10" cy="10" r={RADIUS} stroke="currentColor" strokeWidth="1.5" opacity="0.25" />
      <circle
        cx="10"
        cy="10"
        r={RADIUS}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray={`${CIRCUMFERENCE * ARC} ${CIRCUMFERENCE}`}
      />
    </svg>
  );
}
