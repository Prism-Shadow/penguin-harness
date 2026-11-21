import type { ButtonHTMLAttributes } from "react";

/** The compact look for an inline action: a quiet glyph that fills in on hover. */
const LOOK =
  "rounded-sm text-fg-subtle transition-colors duration-150 hover:bg-surface-muted hover:text-fg-muted";

const SIZE = {
  // Beside a line of small text (an id, a path, a stats row): a 20 px square, the line height
  // those rows keep, so the button sits on the line without making it taller.
  sm: "inline-flex size-5 items-center justify-center",
  // A message footer, a code block's corner: the glyph with a rhythm step of padding round it.
  md: "p-1",
} as const;

/** A quiet glyph in a text row. The label doubles as its tooltip and accessible name. */
export function InlineIconButton({
  label,
  size = "sm",
  className = "",
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & {
  label: string;
  size?: keyof typeof SIZE;
}) {
  return (
    <button
      type="button"
      {...props}
      data-tooltip={label}
      aria-label={label}
      className={`${LOOK} ${SIZE[size]} disabled:cursor-wait disabled:opacity-50 ${className}`}
    />
  );
}
