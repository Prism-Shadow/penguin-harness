/**
 * The dock's public face: a panel's display name, for a surface outside the docks that names one
 * (the draft's Files toggle). The panels themselves arrive through the `panels` slot (iface.ts).
 */
export { panelLabel } from "./panel-registry";
export { DockLauncher } from "./dock-launcher";
export { setDockCwd } from "./dock-terminal";
export { dockVersion } from "./dock-state";
export { openPanel } from "./dock-state";
export { panelDock } from "./dock-state";
export { subscribeDock } from "./dock-state";
export { adoptDockScope } from "./dock-state";
export { isTabShown } from "./dock-state";
export { useDockMount } from "./use-dock-mount";
export { closedDockView } from "./dock-state";
export { dockViews } from "./dock-state";
export { DockPanel } from "./dock-panel";

export type { DockPanelBodyProps, PanelId } from "./panel-registry";

export { docksOnScreen } from "./dock-state";

export { dockWorkspace } from "./dock-terminal";

export { currentDockScope } from "./dock-state";

export { isDockVisible } from "./dock-state";

export { toggleDock } from "./dock-state";

export type { DockPosition } from "./dock-state";

export { setCloseGuard } from "./close-guard";

export { tabKey } from "./dock-state";

export { launcherHiddenVersion } from "./dock-launcher-state";

export { readLauncherHidden } from "./dock-launcher-state";

export { subscribeLauncherHidden } from "./dock-launcher-state";

export { writeLauncherHidden } from "./dock-launcher-state";

export { setDockScope } from "./dock-state";
