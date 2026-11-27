/**
 * A store card: one thing in a catalogue the way an app store lists it — its icon, its name, a
 * line saying what it does and its one action button (`InstallButton`), with no cover. The cover
 * belongs to the thing's own page; a catalogue of covers is mostly pictures, and a reader looking
 * for one thing among many reads names. The Web App's plugin market lists its plugins with it.
 *
 * Two layouts, both icon-led and both with the action in a fixed place:
 *
 * - `card`, in a grid: a framed card, the icon beside the name over a description of two lines
 *   (the box holds two lines whether the text fills them or not, so the cards of a row line up),
 *   and a foot under them — a short muted line of facts at its start, the action at its end.
 * - `row`, in a list: one ruled line with no frame — the icon, the name over a one-line
 *   description, the facts and the action at the row's end, dropping under the text in a narrow
 *   column.
 *
 * The icon, the name and the description are one opener — a link when the host gives an `href`
 * (the thing's page has an address), a button otherwise. A press anywhere else on the card that is
 * not one of its controls opens it too, as every catalogue card does; the action sits outside the
 * opener, since a control wrapped around another hides it from assistive technology. The text gives
 * way and the icon and the action never do: the name truncates to one line (whole on hover), the
 * description clamps.
 *
 * `StoreGrid` lays the cards out by the width of the column it stands in: as many columns of at
 * least 15 rem as fit (one on a phone), the gutters wide enough that each card reads as one thing.
 * Its list layout stands the rows two abreast wherever two of at least 22 rem fit, one otherwise
 * (or always one, `one`): a row's floor is the larger of 22 rem and half the width less half the
 * gutter (and a pixel, so rounding never drops the second column).
 *
 * Props only: every word, the icon and the action are the caller's.
 */
import type { HTMLAttributes, MouseEvent, ReactNode, Ref } from "react";
import { Card } from "../layout/card/card";

export type StoreCardLayout = "card" | "row";

export interface StoreCardProps extends Omit<HTMLAttributes<HTMLElement>, "title" | "onClick"> {
  layout?: StoreCardLayout;
  /** The thing's icon, drawn at the layout's size by the caller (`STORE_ICON_PX`). */
  icon: ReactNode;
  title: string;
  /** The id behind a display name, on the title's hover. */
  titleHint?: string;
  description: string;
  /** A short line of facts at the foot's start (where it came from, who uses it); one line. */
  meta?: ReactNode;
  /** The card's one action (`InstallButton`), at the foot's end. */
  action?: ReactNode;
  /** The thing's page, when it has an address: the opener is then a link. */
  href?: string;
  /** Opens the thing: the opener's press, or the link's click (the host may route it). */
  onOpen?: (event: MouseEvent<HTMLElement>) => void;
  /** What the card owns besides: its dialogs. */
  children?: ReactNode;
}

/** The icon's edge in px, per layout: large enough to read a glyph, small enough to lead a line. */
export const STORE_ICON_PX: Readonly<Record<StoreCardLayout, number>> = { card: 48, row: 36 };

/**
 * A press on the card's own surface: inside its box (not in a dialog it owns, which React hands
 * up through the portal) and on none of its controls (the opener acts itself).
 */
function bodyPress(event: MouseEvent<HTMLElement>): boolean {
  const target = event.target as Element | null;
  if (target === null || !event.currentTarget.contains(target)) return false;
  return target.closest("a, button, input, select, textarea, label, summary") === null;
}

export function StoreCard({
  layout = "card",
  icon,
  title,
  titleHint,
  description,
  meta,
  action,
  href,
  onOpen,
  children,
  className = "",
  ...rest
}: StoreCardProps) {
  const row = layout === "row";
  const text = (
    <>
      <span className="flex shrink-0">{icon}</span>
      <span className="block min-w-0 flex-1">
        <span
          className="block truncate text-sm font-semibold text-fg"
          {...(titleHint !== undefined
            ? { "data-tooltip": titleHint, "data-tooltip-content": "code" }
            : {})}
        >
          {title}
        </span>
        <span
          className={`mt-0.5 text-xs leading-5 text-fg-muted ${
            row ? "block truncate" : "line-clamp-2 min-h-10"
          }`}
        >
          {description}
        </span>
      </span>
    </>
  );
  const openerClass = `flex min-w-0 flex-1 gap-3 text-left ${row ? "items-center" : "items-start"}`;
  const opener =
    href !== undefined ? (
      <a href={href} onClick={onOpen} className={`${openerClass} no-underline`}>
        {text}
      </a>
    ) : (
      <button type="button" onClick={onOpen} className={openerClass}>
        {text}
      </button>
    );
  const foot = (meta != null || action != null) && (
    <div
      className={`flex min-w-0 items-center gap-3 ${
        row ? "shrink-0 @max-[26rem]:basis-full" : "mt-3 justify-between"
      }`}
    >
      {meta != null && (
        <span className="min-w-0 truncate text-xs text-fg-muted" data-store="meta">
          {meta}
        </span>
      )}
      {action != null && <span className="ml-auto flex shrink-0">{action}</span>}
    </div>
  );
  const press = (event: MouseEvent<HTMLElement>) => {
    if (onOpen !== undefined && bodyPress(event)) onOpen(event);
  };
  if (row) {
    return (
      <article
        {...rest}
        data-store="card"
        data-layout="row"
        onClick={press}
        className={`@container flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-muted py-3 ${className}`}
      >
        {opener}
        {foot}
        {children}
      </article>
    );
  }
  return (
    <Card
      {...rest}
      as="article"
      padding="md"
      interactive
      data-store="card"
      data-layout="card"
      onClick={press}
      className={`flex min-w-0 flex-col ${className}`}
    >
      {opener}
      {foot}
      {children}
    </Card>
  );
}

/** The cards in a responsive grid, or the rows in a list of one or two columns. */
export function StoreGrid({
  layout = "card",
  one = false,
  className = "",
  children,
  ref,
  ...rest
}: HTMLAttributes<HTMLDivElement> & {
  layout?: StoreCardLayout;
  /** Rows in one column at any width: a list read top to bottom (what is installed). */
  one?: boolean;
  ref?: Ref<HTMLDivElement>;
}) {
  return (
    <div
      {...rest}
      ref={ref}
      data-store="grid"
      data-layout={layout}
      className={`grid ${
        layout === "row"
          ? one
            ? "grid-cols-1"
            : "grid-cols-[repeat(auto-fill,minmax(min(100%,max(22rem,calc(50%_-_var(--spacing)*3_-_1px))),1fr))] gap-x-6"
          : "grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-6"
      } ${className}`}
    >
      {children}
    </div>
  );
}

/** A store card's placeholder while a catalogue is read: the same box, nothing in it. */
export function StoreCardSkeleton({ layout = "card" }: { layout?: StoreCardLayout }) {
  const icon = STORE_ICON_PX[layout];
  const bar = "block rounded bg-line-muted";
  const body = (
    <span className="flex min-w-0 flex-1 gap-3">
      <span className={`${bar} shrink-0 rounded-lg`} style={{ width: icon, height: icon }} />
      <span className="block min-w-0 flex-1 space-y-2 pt-1">
        <span className={`${bar} h-3 w-1/2`} />
        <span className={`${bar} h-2.5 w-5/6`} />
      </span>
    </span>
  );
  return layout === "row" ? (
    <div aria-hidden className="flex border-b border-line-muted py-3">
      {body}
    </div>
  ) : (
    <Card aria-hidden padding="md" className="flex min-h-32 flex-col">
      {body}
    </Card>
  );
}
