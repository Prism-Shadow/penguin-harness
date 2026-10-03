/**
 * The button: a small radius, a one-pixel line and a single accent, and nothing that moves but
 * colour. Five variants — the accent `primary`, the bordered `secondary`, `danger` (red ink on the
 * neutral box, the red reserved for hover), the borderless `ghost` and the `link` that reads as
 * text — on five sizes: three text rungs and two squares for a lone glyph.
 *
 * `loading` puts the one Spinner in the leading slot and marks the button busy, so no call site
 * hand-draws its own ring; the square sizes have one slot, so there the spinner takes the glyph's
 * place. Focus is the base rule every button and link shares, not a ring of its own.
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useUiStrings } from "../../../strings";
import { Spinner } from "../../icons/spinner/spinner";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "link";
export type ButtonSize = "xs" | "sm" | "md" | "icon" | "icon-sm";

const VARIANT: Record<ButtonVariant, string> = {
  // The accent follows the theme and the user's accent choice; the hover dims it rather than
  // naming a second colour, so an accent the user picked needs no hover twin.
  primary:
    "border border-accent bg-accent font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50",
  secondary: "border border-line-emphasis bg-surface font-medium text-fg hover:bg-surface-muted",
  // Red ink on the neutral box at rest; the red line and tint arrive on hover only, so a row of
  // actions does not shout before one is chosen.
  danger:
    "border border-line-emphasis bg-surface font-medium text-tone-danger-fg hover:border-tone-danger-line hover:bg-tone-danger-bg",
  ghost:
    "border border-transparent bg-transparent font-medium text-fg-muted hover:bg-surface-muted hover:text-fg",
  // Text that acts: no box, the link colour, the underline on hover. It keeps the body weight,
  // because a link-button sits in a sentence or a row of plain text.
  link: "text-link underline-offset-2 hover:text-link-hover hover:underline disabled:no-underline",
};

const SIZE: Record<ButtonSize, string> = {
  xs: "rounded-control px-2 py-0.5 text-xs",
  sm: "rounded-control px-2.5 py-1 text-xs",
  md: "rounded-control px-3 py-1.5 text-sm",
  icon: "rounded-control p-1.5",
  "icon-sm": "rounded-control p-1",
};

/** A link-button has no box to pad: only the type rung follows `size`. */
const LINK_SIZE: Record<ButtonSize, string> = {
  xs: "text-xs",
  sm: "text-xs",
  md: "text-sm",
  icon: "",
  "icon-sm": "",
};

/**
 * Layout and motion shared by a real button and the element that stands in for one. The label
 * never wraps: a squeezed button breaks a CJK label between any two characters, so the row it
 * stands in has to make room instead (wrap the row, shrink the text beside it, widen the column).
 */
const BASE =
  "inline-flex items-center justify-center gap-1 whitespace-nowrap transition-colors duration-150";

const look = (variant: ButtonVariant, size: ButtonSize) =>
  `${VARIANT[variant]} ${variant === "link" ? LINK_SIZE[size] : SIZE[size]}`;

const isSquare = (size: ButtonSize) => size === "icon" || size === "icon-sm";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Busy: the spinner takes the leading slot, and the button is disabled and `aria-busy`. */
  loading?: boolean;
  /** What the spinner announces while `loading`; the interface's busy word when omitted. */
  loadingLabel?: string;
  /** A mark before the label — a glyph, an avatar. The spinner replaces it while `loading`. */
  leading?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  loadingLabel,
  leading,
  className = "",
  title,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  const strings = useUiStrings();
  // `title` is the hover hint, shown by the app's tooltip layer rather than the browser's own.
  // The native attribute also named a wordless button; the tooltip layer names nothing, so a
  // square button whose only label was its title keeps it as its accessible name.
  const nameless =
    isSquare(size) && rest["aria-label"] === undefined && rest["aria-labelledby"] === undefined;
  const spinner = loading ? <Spinner size="sm" label={loadingLabel ?? strings.loading} /> : null;
  return (
    <button
      type="button"
      data-tooltip={title}
      {...(nameless && title !== undefined ? { "aria-label": title } : {})}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={`${BASE} disabled:cursor-not-allowed disabled:opacity-60 ${look(variant, size)} ${className}`}
      {...rest}
    >
      {isSquare(size) && spinner !== null ? (
        spinner
      ) : (
        <>
          {spinner ?? leading}
          {children}
        </>
      )}
    </button>
  );
}

export interface IconButtonProps extends Omit<
  ButtonProps,
  "size" | "leading" | "aria-label" | "aria-labelledby"
> {
  /** The accessible name, and the tooltip unless `title` gives a shorter one. */
  label: string;
  size?: "sm" | "md";
}

/**
 * A square button holding one glyph. A wordless control is unreadable without a name, so the
 * name is required here rather than remembered at each call site: it becomes the `aria-label`
 * and, unless `title` says something shorter (the row's verb without the row's name), the tooltip.
 */
export function IconButton({ label, size = "md", title, ...rest }: IconButtonProps) {
  return (
    <Button
      {...rest}
      size={size === "sm" ? "icon-sm" : "icon"}
      aria-label={label}
      title={title ?? label}
    />
  );
}

/**
 * The Button look on an element that cannot be a `<button>`: the `<label>` a file picker needs,
 * since the hidden `<input type="file">` has to be labelled to be clickable. Built from the records
 * `Button` reads, so a variant or a rung moves in one place.
 *
 * Two deliberate differences from `Button`: the focus outline is drawn while the input inside has
 * keyboard focus, because the label itself never takes focus, and `cursor-pointer` is spelled out,
 * which a `<button>` gets from the base rules and a `<label>` does not.
 */
export function buttonClass(
  variant: ButtonVariant,
  size: Exclude<ButtonSize, "icon" | "icon-sm">,
): string {
  return `${BASE} cursor-pointer has-[:focus-visible]:[outline:var(--ui-focus-ring)] has-[:focus-visible]:[outline-offset:var(--ui-focus-ring-offset)] ${look(variant, size)}`;
}
