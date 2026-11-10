import type { ComponentType } from "react";
import { Interface, type Slot } from "@prismshadow/penguin-core/kernel";

import type { NavBadge, SidebarMode, SidebarSection } from "../../lib/sidebar-contributions";

/** The pinned column's props (the app layout mounts it beside the page and in the phone's drawer). */
export interface SidebarColumnProps {
  /** Called after a navigation from inside the column: the drawer closes on it. */
  onNavigate?: () => void;
  /** Present on the pinned column: the fold button that swaps it for the rail. */
  onCollapse?: () => void;
  /** Mount with the session search open and focused: the search shortcut pressed on the rail. */
  initialSearchOpen?: boolean;
}

export interface SidebarRailProps {
  onExpand: () => void;
}

/** What the layout around the column reads: the phone's drawer button, and which commands apply. */
export interface SidebarColumnState {
  /** The default mode is current: its New chat and session search are on screen. */
  inDefaultMode: boolean;
  /** What the column lists, the drawer button's name: conversations, or the current mode's list. */
  listName: string;
  /** What a badge anywhere inside says, for the drawer button that covers them all; null = none. */
  menuNote: string | null;
}

@Interface()
export abstract class Sidebar {
  abstract readonly Column: ComponentType<SidebarColumnProps>;
  abstract readonly Rail: ComponentType<SidebarRailProps>;
  /** A React hook: the column's state for the layout around it. */
  abstract useColumnState(): SidebarColumnState;
}

export interface SidebarSlots {
  /** A block of the column, shown while its work mode is the current one. */
  sections: Slot<SidebarSectionData, SidebarSection>;
  /** A work mode beside the default; contributing one adds it to the mode switch. */
  modes: Slot<SidebarModeData, SidebarMode>;
  /** A mark on a page's nav row, the account row or the drawer button. */
  navBadges: Slot<NavBadgeData, NavBadge>;
}

export { DEFAULT_MODE } from "../../lib/sidebar-slot-data";
export type {
  SidebarSectionData,
  SidebarModeData,
  NavBadgeData,
} from "../../lib/sidebar-slot-data";
import type {
  SidebarSectionData,
  SidebarModeData,
  NavBadgeData,
} from "../../lib/sidebar-slot-data";
