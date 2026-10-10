/**
 * What the dock tells a panel body about its own tab — where it lives, whether it is the shown
 * tab, whether its surface is fullscreen — and the two things a body may ask for: fullscreen on
 * or off, and its own tab closed. One hook, the same for a built-in body and for the plugin
 * panels to come, so a body never reaches into the dock store for its own circumstances: the
 * store speaks in tab keys and positions, which a body knows nothing about unless told.
 *
 * The provider is the dock's (dock-panel.tsx wraps every panel body in it); a body reads the
 * handle with `useDockPanel()`, which throws outside a dock — a panel component rendered
 * anywhere else has no tab to describe, and a silent default would hide that mistake.
 */
import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { DockPosition } from "./dock-state";
import type { PanelId } from "./panel-registry";

export interface DockPanelHandle {
  id: PanelId;
  /** Where its tab lives ("bottom" for the narrow merged view's own position). */
  position: DockPosition;
  merged: boolean;
  /** Same as the body's `active` prop. */
  active: boolean;
  /** Whether the surface holding it is fullscreen. */
  fullscreen: boolean;
  setFullscreen: (on: boolean) => void;
  /** Removes the tab (honours close guards, like the tab's ×). */
  close: () => void;
}

const DockPanelContext = createContext<DockPanelHandle | null>(null);

/** Wraps one panel body; the dock renders it around every panel tab's body. */
export function DockPanelProvider({
  handle,
  children,
}: {
  handle: DockPanelHandle;
  children: ReactNode;
}) {
  return <DockPanelContext.Provider value={handle}>{children}</DockPanelContext.Provider>;
}

/** The handle of the panel body this is called from; throws outside a dock body. */
export function useDockPanel(): DockPanelHandle {
  const handle = useContext(DockPanelContext);
  if (handle === null) {
    throw new Error("useDockPanel() is only available inside a dock panel body");
  }
  return handle;
}
