/**
 * The card: a bordered box on the surface that holds one thing — a chart, a summary, a list of
 * rows, a table — with an optional header row naming it.
 *
 * Two paddings cover the app's shells. A padded card (`sm`, the common one, or `md` for a roomy
 * intro block) keeps its content inside the padding, and its header is a title row above the
 * content. A flush card (`none`) lets rows and tables run edge to edge and clips them to its
 * radius, so a row's hover fill never squares off the corners; its header is a strip ruled off
 * from the rows below.
 *
 * The card carries the `ui-frame` hook, so a theme can redraw the box — Console squares it off,
 * Frost softens the line — without a call site knowing. A flush card's header strip is the
 * frame's `head` slot, which a theme may rule or unfill; a padded card's title row sits inside
 * the padding, not across the frame, and is no slot. One card per region: a card never sits in
 * another card; a table inside one is a bare `Table` (`framed={false}`).
 */
import { createContext, useContext } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { ICON_GAP } from "../../../icon-scale";
import { InfoPopover } from "../../overlays/info-popover/info-popover";

export type CardPadding = "none" | "sm" | "md";

const PADDING: Record<CardPadding, string> = {
  none: "overflow-hidden",
  sm: "p-3",
  md: "p-4",
};

/** The enclosing card's padding, so a header knows whether it is a title row or a ruled strip. */
const CardPaddingContext = createContext<CardPadding>("sm");

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** The element to render: a `section` for a titled panel, an `li` for a card in a list. */
  as?: "div" | "section" | "article" | "li";
  /** `sm` (the default) and `md` pad the content; `none` lets rows run edge to edge. */
  padding?: CardPadding;
  children?: ReactNode;
}

export function Card({
  as: Tag = "div",
  padding = "sm",
  className = "",
  children,
  ...rest
}: CardProps) {
  return (
    <CardPaddingContext.Provider value={padding}>
      <Tag
        {...rest}
        className={`ui-frame min-w-0 rounded-md border border-line bg-surface ${PADDING[padding]} ${className}`}
      >
        {children}
      </Tag>
    </CardPaddingContext.Provider>
  );
}

export interface CardHeaderProps {
  /** What the card holds, in the small muted rung. */
  title: ReactNode;
  /** One quiet line under the title. */
  description?: ReactNode;
  /** What the card means, disclosed by a "?" beside the title. */
  info?: ReactNode;
  /** Controls at the end of the row: a filter, a range switch, an add button. */
  actions?: ReactNode;
  /** The title's outline level: 3 under a page's sections (the default), 2 under the page title. */
  level?: 2 | 3 | 4;
  className?: string;
}

/**
 * The card's header: the title (with its "?"), an optional line under it, and the actions at the
 * end. In a padded card it is the row above the content; in a flush card, a strip ruled off from
 * the rows below.
 */
export function CardHeader({
  title,
  description,
  info,
  actions,
  level = 3,
  className = "",
}: CardHeaderProps) {
  const flush = useContext(CardPaddingContext) === "none";
  const Title = level === 2 ? "h2" : level === 4 ? "h4" : "h3";
  return (
    <div
      data-slot={flush ? "head" : undefined}
      className={`flex flex-wrap items-center justify-between gap-x-2 gap-y-1 ${
        flush ? "border-b border-line-muted px-3 py-2" : "mb-2"
      } ${className}`}
    >
      <div className="min-w-0">
        <Title
          className={`flex min-w-0 items-center ${ICON_GAP.row} text-xs font-medium text-fg-muted`}
        >
          {title}
          {info !== undefined && (
            <InfoPopover label={typeof title === "string" ? title : undefined}>{info}</InfoPopover>
          )}
        </Title>
        {description !== undefined && (
          <p className="mt-0.5 text-xs text-fg-subtle">{description}</p>
        )}
      </div>
      {actions !== undefined && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
