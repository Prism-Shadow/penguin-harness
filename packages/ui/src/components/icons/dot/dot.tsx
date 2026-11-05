/**
 * The state dot: a small solid disc in a tone's fill, beside a label or inside a row that already
 * names the state. A dot this small has no interior to read, so it takes the tone's solid fill
 * (`emphasis`) rather than an ink tuned for a stroke, and it stays round in every theme — a
 * square theme squares its badges and controls, never its dots.
 *
 * Colour is never the only carrier. A dot inside a labelled row is decorative and hidden from
 * assistive technology; a dot standing alone takes `label`, which names it as an image.
 *
 * `pulse` is for something that is running right now and nothing else: the dot carries the
 * live hook, so a theme may re-time or restep the pulse and reduced motion stills it. This file
 * is where a dot's pulse lives, which is why a pulsing dot is always this component.
 */
import type { ToneName } from "../../../tokens";

/**
 * Pixel sizes, the icon-scale convention: a dot never scales with the root font tier. The 6px
 * rung, a row's state dot, is the common case and the default.
 */
const SIZES = { xs: 6, sm: 8, md: 10 } as const;

export type DotSize = keyof typeof SIZES;

const FILL: Record<ToneName, string> = {
  success: "bg-tone-success-emphasis",
  attention: "bg-tone-attention-emphasis",
  danger: "bg-tone-danger-emphasis",
  done: "bg-tone-done-emphasis",
  neutral: "bg-tone-neutral-emphasis",
  info: "bg-tone-info-emphasis",
};

export function Dot({
  tone,
  size = "xs",
  pulse = false,
  label,
  className = "",
}: {
  tone: ToneName;
  size?: DotSize;
  /** Pulse while the thing it marks is live. */
  pulse?: boolean;
  /** Names a dot that stands alone; without it the dot is decoration beside a label. */
  label?: string;
  /** Layout only (a margin, an alignment); the colour and the size are the props'. */
  className?: string;
}) {
  const px = SIZES[size];
  return (
    <span
      {...(label === undefined
        ? { "aria-hidden": true }
        : { role: "img" as const, "aria-label": label })}
      data-live={pulse ? "dot" : undefined}
      style={{ width: px, height: px }}
      className={`inline-block shrink-0 rounded-full ${FILL[tone]} ${pulse ? "ui-live animate-pulse" : ""} ${className}`}
    />
  );
}
