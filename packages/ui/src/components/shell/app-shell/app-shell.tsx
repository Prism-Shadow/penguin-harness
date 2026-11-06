/**
 * The app window: the navigation column beside the main column, and a dock column on the right
 * when the caller has one. It carries the `ui-shell` hook, so a theme may paint a field behind the
 * window, float the main column or rule the columns apart; the columns are its `nav`, `main` and
 * `dock` slots, and the selected row inside the navigation column is the one marked
 * `aria-current="page"`.
 *
 * The navigation column is hidden below `md` — a phone reaches the same content in a drawer,
 * opened from the `MobileTopBar` at the top of the main column — and folds to the rail's width
 * when `navCollapsed`. The fold animates the column's width through the theme's layout motion
 * (`data-layout-motion`), the one property this box may animate at all: the column is in flow, so
 * the main column reflows beside it rather than being slid over, and a transform, a `will-change`
 * or an opacity below 1 would each make it a stacking context and trap the menus the column opens.
 * Its content is laid out at the width it will keep and clipped by the column, so it never
 * reflows mid-fold: the rail sits at its final width from the first frame while the column closes
 * around it, and the pinned sidebar is uncovered left to right.
 *
 * Nothing in the window is fixed or transformed: chrome that makes a stacking context would trap
 * the overlays the columns open.
 *
 * In the desktop app the system's title bar gives way to a band across the window's top,
 * `--window-band-height` tall (window-band.css; zero in a browser). The window reserves it above
 * its columns, so every column starts below it and a column rule never runs between the traffic
 * lights, whatever width the navigation column is folded to. With no `band` the reserved strip
 * shows the window's own fill. With one, the strip is a `band` slot holding the caller's controls
 * after whatever the system draws at its start (the macOS traffic lights, `titlebar-area-x`), and
 * the window takes on the desktop look: the band and the gaps around the main column in the
 * navigation column's colour, and the main column a card inset from the band and the window's
 * edges, in the theme's own surface, line and radius. The band drags the window; its controls do
 * not.
 */
import type { ReactNode } from "react";
import { NavigationBackdrop, WallpaperContext, WallpaperLayer } from "./wallpaper";
import type { WallpaperStyle } from "./wallpaper";

export interface AppShellProps {
  /** Optional wallpaper; omitting it preserves every theme's normal shell surfaces. */
  background?: WallpaperStyle;
  /** The navigation column: the pinned sidebar, or the rail while the column is folded. */
  nav: ReactNode;
  /** Fold the navigation column to the rail's width. */
  navCollapsed?: boolean;
  /** The main column: the mobile top bar, any window-wide notice, the page. */
  children: ReactNode;
  /** A column docked on the right, when the caller has one. */
  dock?: ReactNode;
  /** Layers mounted beside the columns rather than in one: dialogs, the phone's drawer. */
  overlays?: ReactNode;
  /**
   * The desktop window's title band: its controls (the sidebar toggle, back and forward). Given
   * only where the page draws the band itself; the window then frames the main column as a card.
   */
  band?: ReactNode;
}

export function AppShell({
  background,
  nav,
  navCollapsed = false,
  children,
  dock,
  overlays,
  band,
}: AppShellProps) {
  const width = navCollapsed ? "w-12" : "w-64 lg:w-72";
  return (
    <WallpaperContext.Provider value={background}>
      <div
        data-wallpaper={background === undefined ? undefined : ""}
        data-window-band={band === undefined ? undefined : ""}
        className={`ui-shell flex h-full pt-[var(--window-band-height,0px)]${band === undefined ? "" : " relative"}`}
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
        <aside
          data-slot="nav"
          data-layout-motion
          className={`hidden shrink-0 overflow-hidden border-r border-line bg-surface-muted md:block ${width}`}
        >
          <NavigationBackdrop />
          <div className={`h-full ${width}`}>{nav}</div>
        </aside>
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
