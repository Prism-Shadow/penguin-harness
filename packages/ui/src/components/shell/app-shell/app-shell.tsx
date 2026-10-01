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
 */
import type { ReactNode } from "react";

export interface AppShellProps {
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
}

export function AppShell({ nav, navCollapsed = false, children, dock, overlays }: AppShellProps) {
  const width = navCollapsed ? "w-12" : "w-64 lg:w-72";
  return (
    <div className="ui-shell flex h-full">
      <aside
        data-slot="nav"
        data-layout-motion
        className={`hidden shrink-0 overflow-hidden border-r border-line bg-surface-muted md:block ${width}`}
      >
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
  );
}
