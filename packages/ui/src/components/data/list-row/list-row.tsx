/**
 * One row of a list in a flush card: a leading mark, a title with an optional line under it, a
 * quiet meta text and the row's own actions at the end. Rows rule themselves off from the next
 * one and lighten under the pointer, so a row's actions read as its own.
 *
 * A row that opens what it names takes `onClick`: the mark and the text become one button, and
 * the trailing actions stay outside it, since a button cannot hold another. That button is the
 * keyboard's way in; `onBodyClick` takes a click anywhere else on the row's surface, and the
 * caller decides what counts as the body (a control inside the row keeps its own clicks), as an
 * entity card's does.
 *
 * A jump that lands on a row — "show me where this came from" — marks it (`marked`): the row
 * scrolls to the middle of its scroller (at once, never smoothly), its button takes the focus, and
 * it wears the accent wash inside a 2px inset accent ring while the mark lasts — the ring is what
 * reads in a theme whose accent is neutral, where the wash alone is a shade off hover. The mark is
 * a state, not an animation: it holds, then the ring fades on the theme's slow duration as it
 * goes, and under reduced motion it simply goes. The focus is what carries it for a reader who
 * cannot see the colour, and it stands in for the focus the jump took away from the control that
 * started it. {@link useMarkedRow} names the row and clears the mark after two seconds.
 *
 * Every row carries the ring at rest, transparent: an inset shadow cannot interpolate to the
 * plain no-shadow value, so only the ring's colour changes between the states, and it fades.
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
import { Children, useCallback, useEffect, useId, useRef, useState } from "react";
import type { MouseEventHandler, ReactNode } from "react";
import { SettingsEmpty } from "../../feedback/empty-state/empty-state";
import { Waiting } from "../../feedback/waiting/waiting";
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
  if (loading) return <Waiting rows={skeletonRows} />;
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
  /** A click on the row's own surface; the caller decides what counts as the body (the web app's lib/card-open.ts), as an EntityCard's does. `onClick` stays the keyboard's way in. */
  onBodyClick?: MouseEventHandler<HTMLElement>;
  /** A jump landed on this row. When it turns on (or the row mounts with it on) the row scrolls to the middle of its scroller and its own button takes the focus; while on, the row wears the accent wash inside an inset accent ring, and `data-marked`. A state, not an animation. The caller turns it off (useMarkedRow). */
  marked?: boolean;
  /** `li` inside a `ul` or `ol`; a `div` otherwise (the default). */
  as?: "div" | "li";
  className?: string;
}

/** How long a jump's mark stays on the row it landed on. */
const MARK_MS = 2000;

/** Which row of a list a jump just landed on: `mark(key)` names it, and the name clears itself after MARK_MS (2000). Marking again starts the moment over. */
export function useMarkedRow<K>(): { marked: K | null; mark: (key: K) => void } {
  // Boxed, so marking the same key again is a new state and restarts the timer.
  const [state, setState] = useState<{ key: K } | null>(null);
  useEffect(() => {
    if (state === null) return;
    const timer = setTimeout(() => setState(null), MARK_MS);
    return () => clearTimeout(timer);
  }, [state]);
  const mark = useCallback((key: K) => setState({ key }), []);
  return { marked: state === null ? null : state.key, mark };
}

export function ListRow({
  leading,
  title,
  titleTrail,
  description,
  meta,
  trailing,
  onClick,
  onBodyClick,
  marked = false,
  as: Tag = "div",
  className = "",
}: ListRowProps) {
  const descriptionId = useId();
  const rowRef = useRef<HTMLElement | null>(null);
  // The row's own button, in whichever of its two forms it takes.
  const buttonRef = useRef<HTMLButtonElement>(null);
  // A callback ref: the row is a `div` or an `li`, and one function serves both.
  const setRow = useCallback((node: HTMLElement | null) => {
    rowRef.current = node;
  }, []);
  useEffect(() => {
    if (!marked) return;
    // No `behavior`: the jump is instant, whatever the reader's motion setting.
    rowRef.current?.scrollIntoView({ block: "center" });
    buttonRef.current?.focus({ preventScroll: true });
  }, [marked]);
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
          ref={buttonRef}
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
      ref={setRow}
      onClick={onBodyClick}
      {...(marked ? { "data-marked": "" } : {})}
      // The wash follows hover at the fast duration; the mark's ring fades on the slow one. A
      // marked row rounds its corners, so the ring stays inside a card that does not clip (the
      // first or last row of its rounded frame).
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-muted px-3 py-2.5 ring-2 ring-inset transition-[background-color,box-shadow] duration-[var(--ui-dur-fast),var(--ui-dur-slow)] motion-reduce:transition-none last:border-b-0 ${
        marked
          ? "rounded-sm bg-accent-muted ring-accent"
          : "ring-transparent hover:bg-surface-muted"
      } ${className}`}
    >
      {onClick !== undefined && !titleButton ? (
        <button
          ref={buttonRef}
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
