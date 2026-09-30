/**
 * A navigation list and its rows: the rail of a paged dialog, a settings rail, the sidebar's page
 * links, and (later) the dock's picker. A row is a glyph, a label and an optional trailing badge;
 * the current row takes a solid fill and `aria-current="page"`, the others a lighter fill under the
 * pointer.
 *
 * `NavList` is the named `<nav>`. Vertical, its rows stack at the rail's width; responsive, it is
 * a horizontal strip that scrolls sideways below the `sm` breakpoint and a vertical rail from it
 * up, the way a dialog's rail folds above its pane on a phone. The list lays its rows out only:
 * the rail's width, padding and rule are the caller's.
 *
 * `NavRow` is a button by default (a rail that switches panes), a link with `href`. The glyph is
 * decoration — the label beside it already says what it says — so it carries the
 * `ui-icon-decor` hook with the `nav` role, and a theme may recolour or drop it. A label is text,
 * never mono. A router's link draws the row through `renderLink`, which hands it the row's
 * classes, state and content; an element the row does not draw at all takes the row's look
 * through {@link navRowClass}.
 *
 * A row on the app's navigation column (`surface="muted"`) sits on the muted surface, where a
 * surface step would not show: its hover and its selection are thin washes of the ink instead
 * ({@link NAV_FILL}), which every other row on that column reads too.
 */
import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { ICON_GAP, ICON_SIZE } from "../../../icon-scale";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";

export type NavListOrientation = "vertical" | "responsive";

/** `md` for a rail or a sidebar (the default); `sm` for a dense list inside a panel. */
export type NavRowDensity = "sm" | "md";

/**
 * What a row sits on: `default`, a page or a dialog; `muted`, the app's navigation column, whose
 * own fill is the muted surface.
 */
export type NavSurface = "default" | "muted";

/**
 * The fills of a row on the navigation column's muted surface: a wash of the ink under the
 * pointer and a slightly heavier one on the selected row. The column's page rows, its
 * conversation rows, the rail's entries and the column's own controls all take these two, so one
 * hover and one selection hold across the column.
 */
export const NAV_FILL = {
  hover: "hover:bg-fg/5",
  selected: "bg-fg/7",
} as const;

const NavOrientationContext = createContext<NavListOrientation>("vertical");

export interface NavListProps {
  /** The navigation's accessible name: what the rows switch between. */
  label: string;
  orientation?: NavListOrientation;
  /** The rail's own box: its width, padding and rule. */
  className?: string;
  children?: ReactNode;
}

const LIST: Record<NavListOrientation, string> = {
  vertical: "flex flex-col gap-1",
  responsive: "flex gap-1 overflow-x-auto sm:flex-col sm:overflow-x-visible",
};

export function NavList({
  label,
  orientation = "vertical",
  className = "",
  children,
}: NavListProps) {
  return (
    <NavOrientationContext.Provider value={orientation}>
      <nav aria-label={label} className={`${LIST[orientation]} ${className}`}>
        {children}
      </nav>
    </NavOrientationContext.Provider>
  );
}

const DENSITY: Record<NavRowDensity, string> = {
  md: `${ICON_GAP.menu} px-2.5 py-1.5 text-sm`,
  sm: `${ICON_GAP.row} px-2 py-1 text-xs`,
};

const GLYPH_SIZE: Record<NavRowDensity, number> = {
  md: ICON_SIZE.navRow,
  sm: ICON_SIZE.inlineGlyph,
};

/** The selected and resting looks, per surface. */
const STATE: Record<NavSurface, { active: string; rest: string }> = {
  default: {
    active: "bg-line-muted font-medium text-fg",
    rest: "text-fg-muted hover:bg-surface-muted hover:text-fg",
  },
  muted: {
    active: `${NAV_FILL.selected} font-medium text-fg`,
    rest: `text-fg-muted ${NAV_FILL.hover} hover:text-fg`,
  },
};

/**
 * A row's classes, for an element the row cannot render itself. The width follows the list: full
 * in a vertical rail, the label's own in a horizontal strip, which keeps every row whole rather
 * than squeezing their labels.
 */
export function navRowClass({
  active = false,
  disabled = false,
  density = "md",
  orientation = "vertical",
  surface = "default",
}: {
  active?: boolean;
  disabled?: boolean;
  density?: NavRowDensity;
  orientation?: NavListOrientation;
  surface?: NavSurface;
} = {}): string {
  const width = orientation === "responsive" ? "shrink-0 sm:w-full" : "w-full";
  const state = disabled
    ? "cursor-not-allowed text-fg-subtle"
    : active
      ? STATE[surface].active
      : STATE[surface].rest;
  return `flex ${width} items-center whitespace-nowrap rounded-md text-left transition-colors duration-150 ${DENSITY[density]} ${state}`;
}

/**
 * What a row hands `renderLink`: everything its own `<a>` would carry, for the caller's link
 * element to spread onto itself (a router's link takes `href` as its destination).
 */
export interface NavRowLinkProps {
  href: string;
  className: string;
  "aria-current"?: "page";
  "aria-label"?: string;
  "data-tooltip"?: string;
  onClick?: () => void;
  children: ReactNode;
}

export interface NavRowProps {
  label: ReactNode;
  /** A 24×24 line path drawn on the row's glyph rung, or a mark the caller sizes. Decorative. */
  glyph?: string | ReactNode;
  /** Trailing: a count, a badge, an update dot. */
  badge?: ReactNode;
  /** The current page: the solid fill and `aria-current="page"`. */
  active?: boolean;
  /** Nowhere to go right now: muted, no hover fill, not focusable as a link. */
  disabled?: boolean;
  density?: NavRowDensity;
  /** The surface the row sits on: `muted` on the app's navigation column. */
  surface?: NavSurface;
  /** Renders a link to this address instead of a button. */
  href?: string;
  /** With `href`: draws the link through the caller's own element (a router's) instead of `<a>`. */
  renderLink?: (link: NavRowLinkProps) => ReactNode;
  onClick?: () => void;
  /** The accessible name, when the badge adds to what the label says. */
  ariaLabel?: string;
  /** A hint on hover and focus. */
  tooltip?: string;
  className?: string;
}

export function NavRow({
  label,
  glyph,
  badge,
  active = false,
  disabled = false,
  density = "md",
  surface = "default",
  href,
  renderLink,
  onClick,
  ariaLabel,
  tooltip,
  className = "",
}: NavRowProps) {
  const orientation = useContext(NavOrientationContext);
  const classes = `${navRowClass({ active, disabled, density, orientation, surface })} ${className}`;
  const current = active && !disabled ? ("page" as const) : undefined;
  const named = {
    ...(ariaLabel !== undefined ? { "aria-label": ariaLabel } : {}),
    ...(tooltip !== undefined ? { "data-tooltip": tooltip } : {}),
  };
  const content = (
    <>
      {glyph !== undefined && (
        <span aria-hidden className="ui-icon-decor shrink-0 text-fg-subtle" data-role="nav">
          {typeof glyph === "string" ? <GlyphIcon d={glyph} size={GLYPH_SIZE[density]} /> : glyph}
        </span>
      )}
      <span className="min-w-0 truncate">{label}</span>
      {badge !== undefined && <span className="ml-auto flex shrink-0 items-center">{badge}</span>}
    </>
  );
  if (href !== undefined) {
    // A link with nowhere to go keeps its place in the list but leaves the tab order.
    if (disabled) {
      return (
        <span role="link" aria-disabled="true" {...named} className={classes}>
          {content}
        </span>
      );
    }
    if (renderLink !== undefined) {
      return (
        <>
          {renderLink({
            href,
            className: classes,
            ...(current !== undefined ? { "aria-current": current } : {}),
            ...named,
            ...(onClick !== undefined ? { onClick } : {}),
            children: content,
          })}
        </>
      );
    }
    return (
      <a href={href} aria-current={current} onClick={onClick} {...named} className={classes}>
        {content}
      </a>
    );
  }
  return (
    <button
      type="button"
      aria-current={current}
      disabled={disabled}
      onClick={onClick}
      {...named}
      className={classes}
    >
      {content}
    </button>
  );
}
