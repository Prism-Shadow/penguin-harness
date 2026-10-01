/**
 * A page of the app: `PageFrame` is the scrolling column a page sits in, at the width it reads
 * best at, and `PageHeader` its title row — the page's one display title with its "?", a line
 * under it, the page's actions at the end, and an optional way back above it.
 *
 * The title is the page's one `h1`, carrying the display hook (`ui-display`) so a theme restyles
 * every page title at once. It keeps the app's page-title size (`text-xl`, semibold), not the
 * theme's h1 rung. A page header never carries an eyebrow: the title is the page's name, not a
 * group label over it.
 */
import type { ReactNode } from "react";
import { ICON_GAP, ICON_SIZE } from "../../../icon-scale";
import { Button } from "../../actions/button/button";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";
import { InfoPopover } from "../../overlays/info-popover/info-popover";

/**
 * How wide the column grows: `sm` a settings-shaped page, `md` a detail page, `lg` a list page
 * (the default), `xl` a dashboard, `full` a board that takes the whole width.
 */
export type PageWidth = "sm" | "md" | "lg" | "xl" | "full";

const WIDTH: Record<PageWidth, string> = {
  sm: "mx-auto max-w-3xl",
  md: "mx-auto max-w-4xl",
  lg: "mx-auto max-w-5xl",
  xl: "mx-auto max-w-6xl",
  full: "min-w-0",
};

export interface PageFrameProps {
  width?: PageWidth;
  /** On the scroller: e.g. a stable scrollbar gutter for a page whose filters change its height. */
  className?: string;
  /** On the column inside it: e.g. a vertical rhythm between the page's blocks. */
  contentClassName?: string;
  children?: ReactNode;
}

/** The page's scroller: it fills the main column, scrolls on its own, and centres the column. */
export function PageFrame({
  width = "lg",
  className = "",
  contentClassName = "",
  children,
}: PageFrameProps) {
  return (
    <div className={`h-full overflow-y-auto p-4 md:p-6 ${className}`}>
      <div className={`${WIDTH[width]} ${contentClassName}`}>{children}</div>
    </div>
  );
}

export interface PageHeaderProps {
  /** The page's name. */
  title: ReactNode;
  /** One line under the title: what the page holds, or the entity's id. */
  description?: ReactNode;
  /** What the page is for, disclosed by a "?" beside the title. */
  info?: ReactNode;
  /** The page's own controls (search, filters, create buttons), at the end of the title row. */
  actions?: ReactNode;
  /** The way back to the list this page was opened from, drawn above the title. */
  back?: { label: ReactNode; onClick: () => void };
  /** Blocks that belong to the header, under the title row: a notice, a row of guide steps. */
  children?: ReactNode;
  className?: string;
}

/**
 * The page's title row. The actions wrap under the title on a narrow screen and take the line
 * there, so a search box among them can grow into it.
 */
export function PageHeader({
  title,
  description,
  info,
  actions,
  back,
  children,
  className = "",
}: PageHeaderProps) {
  return (
    <div className={`mb-4 min-w-0 ${className}`}>
      {back !== undefined && (
        <Button
          variant="ghost"
          size="sm"
          leading={<GlyphIcon d={ICONS.arrowLeft} size={ICON_SIZE.rowLead} />}
          onClick={back.onClick}
          className="-ml-2 mb-3"
        >
          {back.label}
        </Button>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1
            className={`ui-display flex min-w-0 items-center ${ICON_GAP.row} text-xl font-semibold`}
          >
            {title}
            {info !== undefined && (
              <InfoPopover label={typeof title === "string" ? title : undefined}>
                {info}
              </InfoPopover>
            )}
          </h1>
          {description !== undefined && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
        </div>
        {actions !== undefined && (
          <div className="flex min-w-0 max-w-full grow flex-wrap items-center justify-end gap-2 sm:grow-0">
            {actions}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
