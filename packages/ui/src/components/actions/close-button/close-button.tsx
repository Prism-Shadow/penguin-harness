/**
 * The close cross of a dialog, drawer or sheet header: the same glyph, padding and hover wherever
 * a layer can be dismissed. Its accessible name is the package's `close` string unless the caller
 * names it; the tooltip is the caller's, when it has something to add. Extra button props (a
 * sheet's pointer-down guard) pass through.
 *
 * `ink="inherit"` is the cross inside a notice: flat (no fill at rest or on hover) and in the
 * notice's own ink, which deepens on hover — a grey cross with a grey hover fill would sit apart
 * from the tone it closes.
 */
import type { ButtonHTMLAttributes } from "react";
import { useUiStrings } from "../../../strings";
import { CloseIcon } from "../../icons/marks/marks";

/** Where the cross takes its ink: the chrome's subtle grey, or the surface it sits on. */
export type CloseButtonInk = "subtle" | "inherit";

const INK: Readonly<Record<CloseButtonInk, string>> = {
  subtle:
    "text-fg-subtle transition-colors duration-150 hover:bg-surface-muted hover:text-fg-muted",
  inherit: "opacity-70 transition-opacity duration-150 hover:opacity-100",
};

export function CloseButton({
  onClose,
  label,
  ink = "subtle",
  className = "",
  title,
  ...rest
}: {
  onClose: () => void;
  /** The accessible name; defaults to the interface's word for "close". */
  label?: string;
  ink?: CloseButtonInk;
  className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick">) {
  const strings = useUiStrings();
  return (
    <button
      type="button"
      aria-label={label ?? strings.close}
      onClick={onClose}
      className={`rounded-control p-1.5 ${INK[ink]} ${className}`}
      data-tooltip={title}
      {...rest}
    >
      <CloseIcon />
    </button>
  );
}
