/**
 * The composer's context ring: how full the model's context is, as one arc in the toolbar's own
 * square. It is a single-colour reading of the whole — no parts — that stays in the muted ink
 * until 80 %, turns to the attention tone past it and to danger past 95 %, so the warning is the
 * ring's colour and never a number beside it.
 *
 * `unknown` (a compaction has just finished and nothing has been measured since) draws the empty
 * track in the muted ink: nothing measured is not the same as measured empty, so it never draws a
 * full-looking zero.
 *
 * The ring draws no numbers, so its accessible name — the caller's `label` — carries them, and is
 * its tooltip too. Given `onClick` the ring is the button that opens whatever the caller hangs off
 * it (the app's context breakdown), with `ref` on that button for the caller's panel to anchor to;
 * its hover paints the square and never the ring, whose colour is the reading. Without it the ring
 * is a named image.
 */
import type { Ref } from "react";
import type { ToneName } from "../../../tokens";
import { Ring } from "../../charts/ring/ring";

/** The share past which the ring turns to the attention tone. */
export const CONTEXT_RING_ATTENTION = 0.8;
/** The share past which it turns to danger. */
export const CONTEXT_RING_DANGER = 0.95;

/** The ring's warning tones. */
export type ContextRingTone = Extract<ToneName, "attention" | "danger">;

/** The ring's tone for a share of the context (0–1), or null for the calm, muted ring. */
export function contextRingTone(ratio: number, unknown = false): ContextRingTone | null {
  if (unknown || !(ratio > CONTEXT_RING_ATTENTION)) return null;
  return ratio > CONTEXT_RING_DANGER ? "danger" : "attention";
}

const INK: Record<ContextRingTone, string> = {
  attention: "text-tone-attention-fg",
  danger: "text-tone-danger-fg",
};

export function ContextRing({
  ratio,
  unknown = false,
  label,
  onClick,
  expanded,
  controls,
  ref,
}: {
  /** How full the context is, 0–1 (clamped). */
  ratio: number;
  /** Nothing has been measured since the context was last replaced: an empty track. */
  unknown?: boolean;
  /** The accessible name and tooltip: the share, and the figures it was computed from. */
  label: string;
  /** Makes the ring a button. */
  onClick?: () => void;
  /** With `onClick`: whether what it opens is open. */
  expanded?: boolean;
  /** With `onClick`: the id of what it opens. */
  controls?: string;
  /** With `onClick`: the button element, for a panel anchored to it. */
  ref?: Ref<HTMLButtonElement>;
}) {
  const share = unknown || !Number.isFinite(ratio) ? 0 : Math.min(1, Math.max(0, ratio));
  const tone = contextRingTone(share, unknown);
  const ink = tone === null ? "text-fg-subtle" : INK[tone];
  // A 12px ring under a 2px stroke in the square's ink: the track is that ink faded, so the
  // warning ladder above recolours the whole ring. Decorative — the square carries the name.
  const ring = (
    <Ring
      segments={share > 0 ? [{ value: share }] : []}
      max={1}
      size={12}
      width={2}
      trackOpacity={0.25}
    />
  );
  // The toolbar's icon square, the size of the controls beside it.
  const square = `flex h-8 w-8 shrink-0 items-center justify-center ${ink}`;
  if (onClick === undefined) {
    return (
      <span data-tooltip={label} aria-label={label} role="img" className={square}>
        {ring}
      </span>
    );
  }
  return (
    <button
      ref={ref}
      type="button"
      data-tooltip={label}
      aria-label={label}
      {...(expanded !== undefined ? { "aria-expanded": expanded } : {})}
      {...(controls !== undefined ? { "aria-controls": controls } : {})}
      onClick={onClick}
      className={`${square} rounded-md transition-colors duration-150 hover:bg-surface-muted`}
    >
      {ring}
    </button>
  );
}
