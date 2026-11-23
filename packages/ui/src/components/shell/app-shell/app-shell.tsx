/**
 * The app window: the navigation column beside the main column, and a dock column on the right
 * when the caller has one. It carries the `ui-shell` hook, so a theme may paint a field behind the
 * window, float the main column or rule the columns apart; the columns are its `nav`, `main` and
 * `dock` slots, and the selected row inside the navigation column is the one marked
 * `aria-current="page"`.
 *
 * The navigation column is hidden below `md` — a phone reaches the same content in a drawer,
 * opened from the `MobileTopBar` at the top of the main column — and folds to the rail's width
 * when `navCollapsed`. With `navResize` the reader sizes the open column by dragging its end
 * edge. How it folds and how it is sized is `NavColumn`'s (nav-column.tsx).
 *
 * Nothing in the window is fixed or transformed: chrome that makes a stacking context would trap
 * the overlays the columns open.
 *
 * In the desktop app the system's title bar gives way to a band across the window's top,
 * `--window-band-height` tall (window-band.css; zero in a browser). The window reserves it above
 * its columns, so every column starts below it and a column rule never runs between the traffic
 * lights, whatever width the navigation column has. With no `band` the reserved strip
 * shows the window's own fill. With one, the strip is a `band` slot holding the caller's controls
 * after whatever the system draws at its start (the macOS traffic lights, `titlebar-area-x`), in
 * the navigation column's colour, so the band and the column read as one surface; the main column
 * keeps the theme's own framing, as in a browser, ruled off from the band by the line that rules
 * it off from the column. The band drags the window; its controls do not.
 */
import type { ReactNode } from "react";
import { NavColumn } from "./nav-column";
import type { NavResize } from "./nav-column";
import { WallpaperContext, WallpaperLayer } from "./wallpaper";
import type { WallpaperStyle } from "./wallpaper";

export type { NavResize } from "./nav-column";

export interface AppShellProps {
  /** Optional wallpaper; omitting it preserves every theme's normal shell surfaces. */
  background?: WallpaperStyle;
  /** The navigation column: the pinned sidebar, or the rail while the column is folded. */
  nav: ReactNode;
  /** Fold the navigation column to the rail's width. */
  navCollapsed?: boolean;
  /** Let a full-screen page use the column while keeping its navigation mounted. */
  navHidden?: boolean;
  /** Let the reader size the open navigation column by dragging its end edge. */
  navResize?: NavResize;
  /** The main column: the mobile top bar, any window-wide notice, the page. */
  children: ReactNode;
  /** A column docked on the right, when the caller has one. */
  dock?: ReactNode;
  /** Layers mounted beside the columns rather than in one: dialogs, the phone's drawer. */
  overlays?: ReactNode;
  /**
   * The desktop window's title band: its controls (the sidebar toggle, back and forward). Given
   * only where the page draws the band itself.
   */
  band?: ReactNode;
}

export function AppShell({
  background,
  nav,
  navCollapsed = false,
  navHidden = false,
  navResize,
  children,
  dock,
  overlays,
  band,
}: AppShellProps) {
  return (
    <WallpaperContext.Provider value={background}>
      <div
        data-wallpaper={background === undefined ? undefined : ""}
        data-window-band={band === undefined ? undefined : ""}
        className={`ui-shell flex h-full ${navHidden ? "[&>[data-slot=nav]]:hidden" : ""} pt-[var(--window-band-height,0px)]${band === undefined ? "" : " relative"}`}
      >
        <WallpaperLayer />
        {band !== undefined && (
          <div
            data-slot="band"
            data-window-drag
            className="absolute inset-x-0 top-0 flex h-[var(--window-band-height,0px)] items-center gap-1 ps-[calc(env(titlebar-area-x,0px)+8px)]"
          >
            {band}
          </div>
        )}
        <NavColumn collapsed={navCollapsed} resize={navResize}>
          {nav}
        </NavColumn>
        <div data-slot="main" className="flex min-w-0 flex-1 flex-col">
          {children}
        </div>
        {dock !== undefined && (
          <div data-slot="dock" className="flex shrink-0 flex-col border-l border-line">
            {dock}
          </div>
        )}
        {overlays}
      </div>
    </WallpaperContext.Provider>
  );
}
