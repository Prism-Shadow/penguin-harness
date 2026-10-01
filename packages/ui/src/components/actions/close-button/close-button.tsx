/**
 * The close cross of a dialog, drawer or sheet header: the same glyph, padding and hover wherever
 * a layer can be dismissed. Its accessible name is the package's `close` string unless the caller
 * names it; the tooltip is the caller's, when it has something to add. Extra button props (a
 * sheet's pointer-down guard) pass through.
 */
import type { ButtonHTMLAttributes } from "react";
import { useUiStrings } from "../../../strings";
import { CloseIcon } from "../../icons/marks/marks";

export function CloseButton({
  onClose,
  label,
  className = "",
  title,
  ...rest
}: {
  onClose: () => void;
  /** The accessible name; defaults to the interface's word for "close". */
  label?: string;
  className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick">) {
  const strings = useUiStrings();
  return (
    <button
      type="button"
      aria-label={label ?? strings.close}
      onClick={onClose}
      className={`rounded-control p-1.5 text-fg-subtle transition-colors duration-150 hover:bg-surface-muted hover:text-fg-muted ${className}`}
      data-tooltip={title}
      {...rest}
    >
      <CloseIcon />
    </button>
  );
}
