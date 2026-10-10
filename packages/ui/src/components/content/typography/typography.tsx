/**
 * The type roles as components: `Heading` on the theme's h1–h6 rungs, `Text` for the body, small,
 * caption, eyebrow, mono and label roles, and `InlineCode` for a code span in running text.
 *
 * Every size, line height, weight, tracking, case and face comes from the theme's rung tokens
 * (`--ui-h<n>-*`, `--ui-text-*`), written as utilities rather than inline styles on purpose: a
 * theme's hook recipe (`ui-display`, `ui-eyebrow`, in the `ui-theme` layer after the utilities)
 * must be able to restyle what the rung set, and an inline style would out-rank it. The rung is the
 * look — a caller wanting a bigger title picks a lower level, not a size class — and a caller's
 * `className` adds layout and ink.
 *
 * Two hooks ride on these: `Heading level={1} display` is the page's one display title
 * (`ui-display`), and `Text variant="eyebrow"` is a group label (`ui-eyebrow`) — which names the
 * items below it and never sits directly above an h1–h4 (the de-slop guard reads this component's
 * variant for that).
 */
import type { HTMLAttributes, ReactNode } from "react";

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/** Each level's rung, spelled whole so Tailwind finds every class in the source. */
const RUNG: Record<HeadingLevel, string> = {
  1: "[font-family:var(--ui-h1-font)] [font-size:var(--ui-h1-size)] [line-height:var(--ui-h1-lh)] [font-weight:var(--ui-h1-weight)] [letter-spacing:var(--ui-h1-tracking)] [text-transform:var(--ui-h1-transform)]",
  2: "[font-family:var(--ui-h2-font)] [font-size:var(--ui-h2-size)] [line-height:var(--ui-h2-lh)] [font-weight:var(--ui-h2-weight)] [letter-spacing:var(--ui-h2-tracking)] [text-transform:var(--ui-h2-transform)]",
  3: "[font-family:var(--ui-h3-font)] [font-size:var(--ui-h3-size)] [line-height:var(--ui-h3-lh)] [font-weight:var(--ui-h3-weight)] [letter-spacing:var(--ui-h3-tracking)] [text-transform:var(--ui-h3-transform)]",
  4: "[font-family:var(--ui-h4-font)] [font-size:var(--ui-h4-size)] [line-height:var(--ui-h4-lh)] [font-weight:var(--ui-h4-weight)] [letter-spacing:var(--ui-h4-tracking)] [text-transform:var(--ui-h4-transform)]",
  5: "[font-family:var(--ui-h5-font)] [font-size:var(--ui-h5-size)] [line-height:var(--ui-h5-lh)] [font-weight:var(--ui-h5-weight)] [letter-spacing:var(--ui-h5-tracking)] [text-transform:var(--ui-h5-transform)]",
  6: "[font-family:var(--ui-h6-font)] [font-size:var(--ui-h6-size)] [line-height:var(--ui-h6-lh)] [font-weight:var(--ui-h6-weight)] [letter-spacing:var(--ui-h6-tracking)] [text-transform:var(--ui-h6-transform)]",
};

type HeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "div" | "p" | "span";

export interface HeadingProps extends HTMLAttributes<HTMLElement> {
  /** The rung, and the outline level: an `h<level>` unless `as` says otherwise. */
  level: HeadingLevel;
  /**
   * The element to render. A non-heading element keeps the outline level through
   * `role="heading"` and `aria-level`.
   */
  as?: HeadingTag;
  /** The page's one display title (the `ui-display` hook); honoured on level 1 only. */
  display?: boolean;
  children?: ReactNode;
}

/** A heading on the theme's rung for its level. */
export function Heading({
  level,
  as,
  display = false,
  className = "",
  children,
  ...rest
}: HeadingProps) {
  const Tag = as ?? (`h${level}` as const);
  const outline = /^h[1-6]$/.test(Tag) ? {} : { role: "heading", "aria-level": level };
  return (
    <Tag
      {...outline}
      {...rest}
      className={`${display && level === 1 ? "ui-display " : ""}${RUNG[level]} ${className}`}
    >
      {children}
    </Tag>
  );
}

export type TextVariant = "body" | "small" | "caption" | "eyebrow" | "mono" | "label";

/**
 * - `body` — the body rung, in the ink around it.
 * - `small` — the small rung, in the ink around it.
 * - `caption` — the caption rung in the muted ink: a note under a figure or a control.
 * - `eyebrow` — a group label on the h6 rung (`ui-eyebrow`), in the subtle ink.
 * - `mono` — the data face at the mono tracking, for ids, paths and commands; the size is the
 *   surrounding text's.
 * - `label` — a field's label: the small rung, semibold, muted, as `FieldLabel` draws it.
 */
const VARIANT: Record<Exclude<TextVariant, "eyebrow">, string> = {
  body: "text-sm",
  small: "text-xs",
  caption:
    "[font-size:var(--ui-text-caption-size)] [line-height:var(--ui-text-caption-lh)] text-fg-muted",
  mono: "font-mono [letter-spacing:var(--ui-tracking-mono)]",
  label: "text-xs font-semibold text-fg-muted",
};

type TextTag = "p" | "span" | "div" | "label" | "dt" | "dd" | "figcaption";

export interface TextProps extends HTMLAttributes<HTMLElement> {
  variant?: TextVariant;
  /** The element to render: a `span` for `mono` and `label`, a `p` for the rest, by default. */
  as?: TextTag;
  children?: ReactNode;
}

/** Running text in one of the type roles. */
export function Text({ variant = "body", as, className = "", children, ...rest }: TextProps) {
  const Tag = as ?? (variant === "mono" || variant === "label" ? "span" : "p");
  const look = variant === "eyebrow" ? "ui-eyebrow text-fg-subtle" : VARIANT[variant];
  return (
    <Tag {...rest} className={`${look} ${className}`}>
      {children}
    </Tag>
  );
}

/**
 * A code span in running text: the data face on a neutral chip, at 0.85em of the text around it —
 * the same chip `.md-body code` draws in Markdown. Long identifiers and paths break anywhere
 * rather than widen their line.
 */
export function InlineCode({
  className = "",
  children,
  ...rest
}: HTMLAttributes<HTMLElement> & { children?: ReactNode }) {
  return (
    <code
      {...rest}
      className={`rounded-sm bg-tone-neutral-bg px-1 py-0.5 font-mono text-[0.85em] text-fg [overflow-wrap:anywhere] ${className}`}
    >
      {children}
    </code>
  );
}
