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
 * It is drawn twice, one direct child of the svg per style, and the theme's CSS shows its own:
 * the arc on its track (`data-set="arc"`) and a pencil spiral wound from the centre out
 * (`data-set="scribble"`), which theme.css hides until a theme shows it. Both turn with the svg,
 * so a theme that swaps the drawing keeps the motion and its reduced-motion stop.
 *
 * The Web App renders it where it used to hand-draw a ring, and the gallery reviews it as the
 * Web App's screens render it — the package ships no demos of its own.
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

/**
 * The scribble: 2.2 turns of a spiral from near the centre out to the arc's radius, 30 points
 * each nudged off the curve by a fixed seed, so it reads as wound by hand and is the same drawing
 * on every render, on the server and in the browser.
 */
const SCRIBBLE = (() => {
  let seed = 7;
  const jitter = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647 - 0.5;
  };
  const points: string[] = [];
  for (let i = 0; i < 30; i++) {
    const t = i / 29;
    const angle = t * 2.2 * 2 * Math.PI;
    const r = 1.5 + t * (RADIUS - 1.5) + jitter() * 0.6;
    points.push(
      `${(10 + r * Math.cos(angle)).toFixed(2)},${(10 + r * Math.sin(angle)).toFixed(2)}`,
    );
  }
  return points.join(" ");
})();

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
      <g data-set="arc">
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
      </g>
      <polyline
        data-set="scribble"
        points={SCRIBBLE}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The ring's stroke, in px: the ring gauges' weight, thin enough not to crowd the icon. */
const RING_STROKE = 2;

/**
 * The ring an app's tile wears while the app installs (builds), like a phone app being
 * installed: one arc on a faint track around the icon, turning at an even pace. It is the
 * spinner's motion — the same live hook, so a theme re-times both alike and reduced motion leaves
 * a still arc — drawn at the size of the box it surrounds (px, never the root font tier). It is
 * decorative: the tile names its state in words.
 */
export function InstallRing({ size, className = "" }: { size: number; className?: string }) {
  const radius = (size - RING_STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const centre = size / 2;
  return (
    <svg
      aria-hidden
      data-live="spinner"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill="none"
      className={`ui-live block animate-spin ${className}`}
      style={{ transformOrigin: "center" }}
    >
      <circle
        cx={centre}
        cy={centre}
        r={radius}
        stroke="currentColor"
        strokeWidth={RING_STROKE}
        opacity="0.2"
      />
      <circle
        cx={centre}
        cy={centre}
        r={radius}
        stroke="currentColor"
        strokeWidth={RING_STROKE}
        strokeLinecap="round"
        strokeDasharray={`${circumference * ARC} ${circumference}`}
      />
    </svg>
  );
}
