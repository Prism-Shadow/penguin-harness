/**
 * The badge: a small capsule that states something about the row it sits in — a state
 * ("running", "failed"), a kind ("module", "admin"), a number — and never a mood ("new", "hot").
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
 * Frost, square in Console.
 *
 * `Count` is the numeric form: a neutral capsule holding a number in tabular figures, so a count
 * that ticks up does not jitter its row.
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
  children: ReactNode;
}

const SOFT: Record<ToneName, string> = {
  success: "bg-tone-success-bg text-tone-success-fg",
  attention: "bg-tone-attention-bg text-tone-attention-fg",
  danger: "bg-tone-danger-bg text-tone-danger-fg",
  done: "bg-tone-done-bg text-tone-done-fg",
  neutral: "bg-tone-neutral-bg text-tone-neutral-fg",
  info: "bg-tone-info-bg text-tone-info-fg",
};

const OUTLINE: Record<ToneName, string> = {
  success: "ring-1 ring-inset ring-tone-success-line text-tone-success-fg",
  attention: "ring-1 ring-inset ring-tone-attention-line text-tone-attention-fg",
  danger: "ring-1 ring-inset ring-tone-danger-line text-tone-danger-fg",
  done: "ring-1 ring-inset ring-tone-done-line text-tone-done-fg",
  neutral: "ring-1 ring-inset ring-tone-neutral-line text-tone-neutral-fg",
  info: "ring-1 ring-inset ring-tone-info-line text-tone-info-fg",
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

const SIZE: Record<BadgeSize, string> = {
  md: "px-2 py-0.5",
  sm: "px-1.5 py-px",
};

export function Badge({ tone = "neutral", variant = "soft", size = "md", children }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-[var(--ui-radius-pill)] text-xs font-semibold ${SIZE[size]} ${VARIANT[variant][tone]}`}
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
    <span className="inline-flex items-center rounded-[var(--ui-radius-pill)] bg-tone-neutral-bg px-1.5 py-px text-xs font-semibold tabular-nums text-tone-neutral-fg">
      {max !== undefined && n > max ? `${max}+` : n}
    </span>
  );
}
