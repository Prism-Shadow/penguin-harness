/**
 * A progress bar: how much of something is done (a download), or how much of a limit is used (a
 * budget). A rounded track in the rule ink with a fill in the accent or in a tone, on three
 * heights.
 *
 * Determinate: the fill's width is `value / max`, clamped, and it moves between readings on the
 * theme's layout motion (`data-layout-motion`), which reduced motion stills. Indeterminate (a
 * backend that reports a phase but no amount): a segment at the start of the track that pulses as
 * a live signal (`ui-live`, `data-live="bar"`: each theme times it, reduced motion stills it) and
 * no `aria-valuenow`, so assistive technology reads it as busy rather than as a third done; the
 * words beside the bar say which phase it is in.
 *
 * `label` names the bar; the caller's other attributes (a tooltip) pass through to it.
 */
import type { HTMLAttributes } from "react";
import type { ToneName } from "../../../tokens";

export type ProgressBarSize = "xs" | "sm" | "md";

const HEIGHT: Readonly<Record<ProgressBarSize, string>> = {
  xs: "h-1",
  sm: "h-1.5",
  md: "h-2",
};

/** The fill: the accent by default, a tone's solid fill when the reading is a judgement. */
const FILL: Readonly<Record<ToneName | "accent", string>> = {
  accent: "bg-accent",
  success: "bg-tone-success-emphasis",
  attention: "bg-tone-attention-emphasis",
  danger: "bg-tone-danger-emphasis",
  done: "bg-tone-done-emphasis",
  neutral: "bg-tone-neutral-emphasis",
  info: "bg-tone-info-emphasis",
};

export function ProgressBar({
  value,
  max = 100,
  indeterminate = false,
  size = "sm",
  tone = "accent",
  label,
  className = "",
  ...rest
}: {
  /** How far along, from 0 to `max`; ignored while indeterminate. */
  value?: number;
  max?: number;
  indeterminate?: boolean;
  size?: ProgressBarSize;
  tone?: ToneName | "accent";
  /** The bar's accessible name. */
  label: string;
  /** Layout only (a width, a margin). */
  className?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, "className" | "children" | "role">) {
  const known = !indeterminate && value !== undefined;
  const clamped = known ? Math.min(max, Math.max(0, value)) : 0;
  const share = max > 0 ? (clamped / max) * 100 : 0;
  return (
    <div
      {...rest}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      {...(known ? { "aria-valuenow": clamped } : {})}
      className={`w-full overflow-hidden rounded-full bg-line-muted ${HEIGHT[size]} ${className}`}
    >
      <div
        {...(known ? { "data-layout-motion": "" } : {})}
        data-live={known ? undefined : "bar"}
        className={`h-full rounded-full ${FILL[tone]} ${known ? "" : "ui-live w-1/3 animate-pulse"}`}
        style={known ? { width: `${share}%` } : undefined}
      />
    </div>
  );
}
