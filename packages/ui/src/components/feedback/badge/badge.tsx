/**
 * The badge: a small capsule that states something about the row it sits in — a state
 * ("running", "failed"), a kind ("module", "admin"), a number — and never a mood ("new", "hot").
 * It is the app's one tag: a label of this shape built by hand would drift from it per theme.
 *
 * Colour comes from the semantic tones, so a badge that reports a state matches every other
 * mark for that state, and one that labels a kind takes `neutral`. Three weights:
 *
 * - `soft` (the default) — the tone's tint under its ink;
 * - `outline` — the tone's line and ink on no fill, for a quieter tag;
 * - `solid` — the tone's solid fill under its label, for a tag that should read as prominent
 *   without claiming more severity than its tone ("default", "origin", "queued" are neutral and
 *   solid).
 *
 * The outline is drawn inside the box, so the three weights share one size and a row of mixed
 * badges stays aligned. The capsule's radius is the theme's pill radius: round in Primer and
 * Frost, square in Console. A badge never wraps its words and never gives way in its row.
 *
 * What a tag looks like beyond its tone is the theme's, through the badge tokens (tokens.ts):
 * a soft badge also draws its tone's line as an inset rule `--ui-badge-soft-ring` wide — 0px
 * where the tint sets the tag off its row, 1px in Console, whose tones have no tint, so there a
 * soft and an outlined badge are the same ruled word — and the weight (`--ui-badge-weight`) and
 * the md padding (`--ui-badge-pad-md`, which Console sets to the sm padding, one tag size) are
 * the theme's too. No theme draws a tint and a rule on one tag: the ring is 0px wherever the
 * tint is not transparent.
 *
 * `Count` is the numeric form: a neutral soft sm badge holding a number in tabular figures, so a
 * count that ticks up does not jitter its row.
 */
import type { ReactNode } from "react";
import type { ToneName } from "../../../tokens";

export type BadgeVariant = "soft" | "outline" | "solid";
export type BadgeSize = "sm" | "md";

/** A badge's colour as data — for a map from an app state to how its badge looks. */
export interface BadgeStyle {
  tone?: ToneName;
  variant?: BadgeVariant;
}

export interface BadgeProps extends BadgeStyle {
  size?: BadgeSize;
  /** The sentence behind the badge's word, on hover (a discount's terms, what "built in" means). */
  tooltip?: string;
  children: ReactNode;
}

const SOFT: Record<ToneName, string> = {
  success: "bg-tone-success-bg text-tone-success-fg ring-tone-success-line",
  attention: "bg-tone-attention-bg text-tone-attention-fg ring-tone-attention-line",
  danger: "bg-tone-danger-bg text-tone-danger-fg ring-tone-danger-line",
  done: "bg-tone-done-bg text-tone-done-fg ring-tone-done-line",
  neutral: "bg-tone-neutral-bg text-tone-neutral-fg ring-tone-neutral-line",
  info: "bg-tone-info-bg text-tone-info-fg ring-tone-info-line",
};

const OUTLINE: Record<ToneName, string> = {
  success: "ring-tone-success-line text-tone-success-fg",
  attention: "ring-tone-attention-line text-tone-attention-fg",
  danger: "ring-tone-danger-line text-tone-danger-fg",
  done: "ring-tone-done-line text-tone-done-fg",
  neutral: "ring-tone-neutral-line text-tone-neutral-fg",
  info: "ring-tone-info-line text-tone-info-fg",
};

const SOLID: Record<ToneName, string> = {
  success: "bg-tone-success-emphasis text-tone-success-emphasis-fg",
  attention: "bg-tone-attention-emphasis text-tone-attention-emphasis-fg",
  danger: "bg-tone-danger-emphasis text-tone-danger-emphasis-fg",
  done: "bg-tone-done-emphasis text-tone-done-emphasis-fg",
  neutral: "bg-tone-neutral-emphasis text-tone-neutral-emphasis-fg",
  info: "bg-tone-info-emphasis text-tone-info-emphasis-fg",
};

const VARIANT: Record<BadgeVariant, Record<ToneName, string>> = {
  soft: SOFT,
  outline: OUTLINE,
  solid: SOLID,
};

/** The inset rule each weight draws in its tone's line: the theme's width for soft, 1px outlined. */
const RING: Record<BadgeVariant, string> = {
  soft: "ring-[length:var(--ui-badge-soft-ring)] ring-inset",
  outline: "ring-1 ring-inset",
  solid: "",
};

const SIZE: Record<BadgeSize, string> = {
  md: "p-[var(--ui-badge-pad-md)]",
  sm: "px-1.5 py-px",
};

function badgeClass(tone: ToneName, variant: BadgeVariant, size: BadgeSize): string {
  return `inline-flex shrink-0 items-center whitespace-nowrap rounded-[var(--ui-radius-pill)] text-xs font-[number:var(--ui-badge-weight)] ${SIZE[size]} ${RING[variant]} ${VARIANT[variant][tone]}`;
}

export function Badge({
  tone = "neutral",
  variant = "soft",
  size = "md",
  tooltip,
  children,
}: BadgeProps) {
  return (
    <span
      {...(tooltip !== undefined ? { "data-tooltip": tooltip } : {})}
      className={badgeClass(tone, variant, size)}
    >
      {children}
    </span>
  );
}

export function Count({
  n,
  max,
}: {
  n: number;
  /** Above this, the capsule reads `max+` rather than growing. */
  max?: number;
}) {
  return (
    <span className={`${badgeClass("neutral", "soft", "sm")} tabular-nums`}>
      {max !== undefined && n > max ? `${max}+` : n}
    </span>
  );
}
