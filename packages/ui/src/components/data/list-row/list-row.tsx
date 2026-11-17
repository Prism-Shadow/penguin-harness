/**
 * One row of a list in a flush card: a leading mark, a title with an optional line under it, a
 * quiet meta text and the row's own actions at the end. Rows rule themselves off from the next
 * one and lighten under the pointer, so a row's actions read as its own.
 *
 * A row that opens what it names takes `onClick`: the mark and the text become one button, and
 * the trailing actions stay outside it, since a button cannot hold another.
 *
 * The text gives way and the actions never do. Title and description truncate to one line each,
 * whatever their length, and a cut-off line shows whole on hover through the app's tooltip layer,
 * which reads the line's own text, so it needs no attribute. The meta and the actions keep their
 * own width; when the row is too narrow for them beside the text they wrap under it, right-aligned,
 * and are never clipped.
 *
 * A string longer than any row can show is cut before it reaches the page ({@link LINE_LIMIT}),
 * ending in an ellipsis, and the line then carries the whole string as its marked hint.
 *
 * Marks and chips about the title — the plugin a part came from, a hook package's hook points —
 * ride `titleTrail`, right after the title on its line. They keep their width; when the title and
 * the trail do not fit side by side the trail wraps under the title, and the title truncates
 * within the line. A trail may hold controls, and a button cannot hold another, so in a row that
 * opens what it names the title alone is the button then, and the trail sits beside it.
 *
 * That holds in any container because the row never asks for its text's width: the text sits in
 * a one-column `minmax(0, 1fr)` grid, whose min-content width is zero, so the row's min-content
 * width is its mark's and its actions'. A `truncate` line otherwise counts at its full length
 * there, and a container that sizes itself to its content's minimum — a grid's `auto` column (a
 * fold's body), a flex item left at `min-width: auto`, a table cell — grew to the longest line and
 * pushed every row's actions past the card's edge. The row's max-content width still counts the
 * full text, so a box that sizes to fit the row (`w-max`) shows it whole.
 */
import { Children, useId } from "react";
import type { ReactNode } from "react";
import { SettingsEmpty } from "../../feedback/empty-state/empty-state";
import { SkeletonList } from "../../feedback/skeleton/skeleton";
import { Card } from "../../layout/card/card";

/**
 * The most of a string title or description a row puts on the page. Laying out a truncated line
 * still walks all of its text, so a row's relayout costs in proportion to the text's length
 * (Chromium, 100 rows resized: 2 ms at 200 characters, 29 ms at 20 000, 254 ms at 200 000). A
 * thousand characters is more than the widest row shows at the smallest text size.
 */
const LINE_LIMIT = 1000;

/** One line of the row's text: a string past the limit is cut, its whole text the line's hint. */
function RowLine({
  className,
  id,
  children,
}: {
  className: string;
  id?: string;
  children: ReactNode;
}) {
  if (typeof children !== "string" || children.length <= LINE_LIMIT) {
    return (
      <span className={className} {...(id !== undefined ? { id } : {})}>
        {children}
      </span>
    );
  }
  // Never end on the first half of a surrogate pair.
  const code = children.charCodeAt(LINE_LIMIT - 1);
  const end = code >= 0xd800 && code <= 0xdbff ? LINE_LIMIT - 1 : LINE_LIMIT;
  return (
    <span
      className={className}
      {...(id !== undefined ? { id } : {})}
      data-tooltip={children}
      data-tooltip-content="text"
      data-tooltip-extra
    >
      {`${children.slice(0, end)}…`}
    </span>
  );
}

/**
 * A settings collection: one shared frame, with semantic rows inside it. While the list is read
 * for the first time (`loading`), placeholder rows stand where it will be; once read, a list with
 * no row and an `empty` sentence says that sentence in the empty slot instead of an empty frame.
 * Without either it renders its frame and rows as they are.
 */
export function SettingsList({
  children,
  label,
  loading = false,
  skeletonRows = 4,
  empty,
}: {
  children: ReactNode;
  label: string;
  /** The list is being read for the first time: placeholder rows stand in. */
  loading?: boolean;
  /** How many placeholder rows (default 4). */
  skeletonRows?: number;
  /** What the list says when it holds no row; omitted, an empty list renders its empty frame. */
  empty?: ReactNode;
}) {
  if (loading) return <SkeletonList rows={skeletonRows} />;
  if (empty !== undefined && Children.toArray(children).length === 0) {
    return <SettingsEmpty>{empty}</SettingsEmpty>;
  }
  return (
    <Card padding="none">
      <ul aria-label={label}>{children}</ul>
    </Card>
  );
}

export interface ListRowProps {
  /** A mark before the text: an avatar, a tile, a glyph. */
  leading?: ReactNode;
  title: ReactNode;
  /** Marks and chips right after the title, on its line: they keep their width, and wrap under the title when the row is narrow. */
  titleTrail?: ReactNode;
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
  titleTrail,
  description,
  meta,
  trailing,
  onClick,
  as: Tag = "div",
  className = "",
}: ListRowProps) {
  const descriptionId = useId();
  const trailed = titleTrail !== undefined && titleTrail !== null && titleTrail !== false;
  // With a trail in a row that opens something, the title is the button and the trail its
  // neighbour; the description names what the button opens.
  const titleButton = trailed && onClick !== undefined;
  const titleLine = !trailed ? (
    <RowLine className="truncate text-sm font-medium text-fg">{title}</RowLine>
  ) : (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
      {titleButton ? (
        <button
          type="button"
          onClick={onClick}
          className="flex min-w-0 max-w-full text-left"
          {...(description !== undefined ? { "aria-describedby": descriptionId } : {})}
        >
          <RowLine className="truncate text-sm font-medium text-fg">{title}</RowLine>
        </button>
      ) : (
        <RowLine className="max-w-full truncate text-sm font-medium text-fg">{title}</RowLine>
      )}
      <span className="flex shrink-0 items-center gap-1.5">{titleTrail}</span>
    </span>
  );
  const text = (
    <>
      {leading !== undefined && <span className="flex shrink-0 items-center">{leading}</span>}
      <span className="grid min-w-0 flex-1 grid-cols-1">
        {titleLine}
        {description !== undefined && (
          <RowLine
            className="mt-0.5 truncate text-xs text-fg-muted"
            {...(titleButton ? { id: descriptionId } : {})}
          >
            {description}
          </RowLine>
        )}
      </span>
    </>
  );
  return (
    <Tag
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-muted px-3 py-2.5 transition-colors last:border-b-0 hover:bg-surface-muted ${className}`}
    >
      {onClick !== undefined && !titleButton ? (
        <button
          type="button"
          onClick={onClick}
          className="flex min-w-0 flex-1 basis-40 items-center gap-3 text-left"
        >
          {text}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 basis-40 items-center gap-3">{text}</div>
      )}
      {(meta !== undefined || trailing !== undefined) && (
        <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-3">
          {meta !== undefined && <span className="text-xs text-fg-subtle">{meta}</span>}
          {trailing !== undefined && (
            <div className="flex flex-wrap items-center justify-end gap-1">{trailing}</div>
          )}
        </div>
      )}
    </Tag>
  );
}
