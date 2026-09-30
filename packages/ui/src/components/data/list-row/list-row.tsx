/**
 * One row of a list in a flush card: a leading mark, a title with an optional line under it, a
 * quiet meta text and the row's own actions at the end. Rows rule themselves off from the next
 * one and lighten under the pointer, so a row's actions read as its own.
 *
 * A row that opens what it names takes `onClick`: the mark and the text become one button, and
 * the trailing actions stay outside it, since a button cannot hold another. Title and description
 * truncate to one line each; the caller puts the whole text in a tooltip where it matters.
 */
import type { ReactNode } from "react";

export interface ListRowProps {
  /** A mark before the text: an avatar, a tile, a glyph. */
  leading?: ReactNode;
  title: ReactNode;
  /** One line under the title. */
  description?: ReactNode;
  /** Quiet text before the actions: a date, a size, a version. */
  meta?: ReactNode;
  /** The row's own actions. */
  trailing?: ReactNode;
  /** Opens what the row names: the mark and the text become one button. */
  onClick?: () => void;
  /** `li` inside a `ul` or `ol`; a `div` otherwise (the default). */
  as?: "div" | "li";
  className?: string;
}

export function ListRow({
  leading,
  title,
  description,
  meta,
  trailing,
  onClick,
  as: Tag = "div",
  className = "",
}: ListRowProps) {
  const text = (
    <>
      {leading !== undefined && <span className="flex shrink-0 items-center">{leading}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-fg">{title}</span>
        {description !== undefined && (
          <span className="mt-0.5 block truncate text-xs text-fg-muted">{description}</span>
        )}
      </span>
    </>
  );
  return (
    <Tag
      className={`flex items-center gap-3 border-b border-line-muted px-3 py-2.5 transition-colors duration-150 last:border-b-0 hover:bg-surface-muted ${className}`}
    >
      {onClick !== undefined ? (
        <button
          type="button"
          onClick={onClick}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          {text}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3">{text}</div>
      )}
      {meta !== undefined && <span className="shrink-0 text-xs text-fg-subtle">{meta}</span>}
      {trailing !== undefined && <div className="flex shrink-0 items-center gap-1">{trailing}</div>}
    </Tag>
  );
}
