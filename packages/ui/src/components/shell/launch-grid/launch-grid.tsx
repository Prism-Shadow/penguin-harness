/**
 * Launch tiles: what a home screen opens things with. A tile is an app's icon over its name, two
 * lines at most — the App Center's tiles and the dock's start page are drawn with it — and a row
 * is the same pair side by side, for a band too short to stack them (a bottom dock).
 *
 * `LaunchGrid` lays tiles out for the width it is given, measured as a container rather than the
 * viewport, since a dock beside a conversation is narrow on any screen. Its columns fill rows
 * evenly: nine tiles that fit four to a row stand three by three, eight stand four by two, so a
 * single tile is never left alone on the last row while a wider row above has room to spare.
 * Every tile is a tab stop and the arrow keys walk the grid as it is drawn: left and right in
 * reading order, up and down a column, Home and End to the ends. Enter or Space opens a tile,
 * since each one is a button.
 */
import { useRef } from "react";
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  HTMLAttributes,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  Ref,
} from "react";
import { ICON_GAP } from "../../../icon-scale";
import { APP_ICON_PX } from "../../icons/app-icon-shape/app-icon-shape";

/** Edge of an app icon in a launch row, in px: a glyph still reads in it, and a row stays one line. */
export const LAUNCH_ROW_ICON_PX = 28;

export type LaunchTileLayout = "tile" | "row";

/**
 * Both layouts take the hover fill and the focus ring on the button itself, so the theme's radius
 * paints every state. A tile's name keeps nearly the whole column, so a dock's narrowest column
 * still holds a long one-word name unbroken, and a row stays short enough for a phone's bottom
 * band to show every choice. A press is held for a menu on touch (the App Center's), so neither a
 * text selection nor the picture's own long-press sheet (save, share) may answer the hold instead.
 */
const LAYOUT: Record<LaunchTileLayout, string> = {
  tile: "flex-col items-center gap-2 px-1 py-2 text-center",
  row: `items-center ${ICON_GAP.menu} px-2 py-1 text-left`,
};
const BUTTON =
  // deslop-ignore-next-line 17: the WebKit property names the long-press sheet, not an aside.
  "flex w-full select-none rounded-lg transition-colors duration-150 [-webkit-touch-callout:none] hover:bg-fg/5 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none";
const NAME: Record<LaunchTileLayout, string> = {
  tile: "line-clamp-2 w-full break-words text-sm leading-snug text-fg",
  row: "min-w-0 flex-1 truncate text-sm text-fg",
};

export function LaunchTile({
  icon,
  name,
  layout = "tile",
  unfoldFade = false,
  className = "",
  children,
  ref,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "name"> & {
  /** The app's icon, drawn at the layout's size by the caller. */
  icon: ReactNode;
  name: ReactNode;
  layout?: LaunchTileLayout;
  /**
   * Inside an unfolding surface (`UnfoldSurface`) the name has no preview to travel from, so it
   * fades in as the surface unfolds.
   */
  unfoldFade?: boolean;
  ref?: Ref<HTMLButtonElement>;
  /** What follows the name: a second, smaller line (the machine an app runs on). */
  children?: ReactNode;
}) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={`${BUTTON} ${LAYOUT[layout]} ${className}`}
    >
      {icon}
      <span data-unfold-fade={unfoldFade || undefined} className={NAME[layout]}>
        {name}
      </span>
      {children}
    </button>
  );
}

export interface LaunchGridItem {
  /** Stable id, and the tile's `data-launch-key`. */
  key: string;
  name: string;
  /** The app's icon at `size` px: `APP_ICON_PX` for a tile, `LAUNCH_ROW_ICON_PX` for a row. */
  icon: (size: number) => ReactNode;
  /** A hover hint that says more than the name, such as the shortcut that opens the same thing. */
  hint?: string;
  testId?: string;
  onLaunch: () => void;
}

/**
 * The columns that hold `count` tiles in rows as even as `most` per row allows: the fewest rows
 * that fit, shared out as equally as they go.
 */
export function evenColumns(count: number, most: number): number {
  if (count <= 0) return 1;
  return Math.ceil(count / Math.ceil(count / most));
}

/**
 * The most tiles a row takes, by the grid's own width. Tiles: three in a dock at its narrowest,
 * four from 28rem, five from 42rem (a dock grown wide, or full screen), each column at most 7rem,
 * so the grid stays a block in the middle of a wide surface rather than strewn across it. Rows:
 * two on a phone, three from 36rem, four from 48rem, each column at most 13rem, so a short band
 * shows every choice in a few lines.
 */
const TIERS: Record<LaunchTileLayout, readonly number[]> = { tile: [3, 4, 5], row: [2, 3, 4] };
const COLUMNS: Record<LaunchTileLayout, string> = {
  tile: "justify-center gap-x-1 gap-y-3 grid-cols-[repeat(var(--launch-cols-0),minmax(0,7rem))] @md/launch:grid-cols-[repeat(var(--launch-cols-1),minmax(0,7rem))] @2xl/launch:grid-cols-[repeat(var(--launch-cols-2),minmax(0,7rem))]",
  row: "justify-center gap-x-3 gap-y-1 grid-cols-[repeat(var(--launch-cols-0),minmax(0,13rem))] @xl/launch:grid-cols-[repeat(var(--launch-cols-1),minmax(0,13rem))] @3xl/launch:grid-cols-[repeat(var(--launch-cols-2),minmax(0,13rem))]",
};

/** Where an arrow key, Home or End moves the focus from `current` in a grid of `columns`. */
function gridTarget(current: number, key: string, count: number, columns: number): number | null {
  switch (key) {
    case "ArrowRight":
      return Math.min(count - 1, current + 1);
    case "ArrowLeft":
      return Math.max(0, current - 1);
    case "ArrowDown":
      // A column the last row is short of steps down to that row's last tile.
      if (current + columns < count) return current + columns;
      return Math.floor(current / columns) < Math.floor((count - 1) / columns) ? count - 1 : null;
    case "ArrowUp":
      return current - columns >= 0 ? current - columns : null;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

export interface LaunchGridProps extends HTMLAttributes<HTMLUListElement> {
  items: readonly LaunchGridItem[];
  /** The list's accessible name. */
  label: string;
  layout?: LaunchTileLayout;
}

export function LaunchGrid({
  items,
  label,
  layout = "tile",
  className = "",
  style,
  onKeyDown,
  ...rest
}: LaunchGridProps) {
  const listRef = useRef<HTMLUListElement | null>(null);
  const columns = Object.fromEntries(
    TIERS[layout].map((most, tier) => [`--launch-cols-${tier}`, evenColumns(items.length, most)]),
  ) as CSSProperties;

  const walk = (event: ReactKeyboardEvent<HTMLUListElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const list = listRef.current;
    if (list === null) return;
    const tiles = [...list.querySelectorAll<HTMLButtonElement>("[data-launch-key]")];
    const current = tiles.indexOf(event.target as HTMLButtonElement);
    if (current === -1) return;
    // The grid as the browser laid it out: one entry per column track.
    const drawn = getComputedStyle(list).gridTemplateColumns.split(" ").filter(Boolean).length;
    const next = gridTarget(current, event.key, tiles.length, Math.max(1, drawn));
    if (next === null) return;
    event.preventDefault();
    tiles[next]?.focus();
  };

  const size = layout === "tile" ? APP_ICON_PX : LAUNCH_ROW_ICON_PX;
  return (
    <div className="@container/launch w-full">
      <ul
        ref={listRef}
        aria-label={label}
        {...rest}
        style={{ ...columns, ...style }}
        onKeyDown={walk}
        className={`grid ${COLUMNS[layout]} ${className}`}
      >
        {items.map((item) => {
          const hint = item.hint !== undefined && item.hint !== item.name ? item.hint : undefined;
          return (
            <li key={item.key} className="min-w-0">
              <LaunchTile
                layout={layout}
                data-launch-key={item.key}
                data-testid={item.testId}
                data-tooltip={hint}
                data-tooltip-extra={hint !== undefined || undefined}
                icon={item.icon(size)}
                name={item.name}
                onClick={item.onLaunch}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
