/**
 * The shapes a module implements to contribute to the sidebar's slots (web-app/sidebar/iface.ts):
 * a section, a work mode, a nav badge. They are a library file rather than WebApp's own so
 * a contributor writes the slot key and implements the shape without importing the shell — the
 * same split as state/user-events.ts for the sessions module's handlers.
 */
import type { ComponentType, ReactNode, RefObject } from "react";

/** What the frame hands a section's scope. */
export interface SidebarScopeProps {
  children: ReactNode;
  /** Whether the section's mode is the current one. */
  current: boolean;
  onNavigate?: () => void;
  /** A pointer that can drag is present (HTML5 drag-and-drop never fires from touch). */
  canDrag: boolean;
  /** The column's root: hidden (`display: none`) below the `md` breakpoint while still mounted. */
  rootRef: RefObject<HTMLDivElement | null>;
  initialSearchOpen: boolean;
}

export interface SidebarSection {
  /**
   * Mounted around the whole column for as long as it is mounted, whatever the mode: where a
   * section keeps what must survive a mode switch (a list's search, its open groups, its dialogs).
   */
  Scope?: ComponentType<SidebarScopeProps>;
  /** Mounted in the column's overlay slot for as long as the column is, inside every scope. */
  Overlays?: ComponentType;
  /** The block itself, mounted only while its mode is current. */
  Full: ComponentType<{ onNavigate?: () => void }>;
  /** The rail's form of the block, below the rail's page entries; absent = not on the rail. */
  Rail?: ComponentType;
}

/** One nav row of a contributed mode, standing in for the page table's rows. */
export interface ModeNavItem {
  key: string;
  /** Where the row leads — null for a row with nowhere to lead, which renders disabled. */
  to: string | null;
  label: string;
  /** A name in the UI package's icon registry. */
  icon: string;
}

/** A contributed mode's state for one render. */
export interface ModeState {
  /** Offered to this user right now. */
  available: boolean;
  current: boolean;
  /** Enters (true) or leaves (false) the mode; answers where the app goes next, null to stay. */
  select(on: boolean): string | null;
  /** The mode's nav rows. */
  navItems: readonly ModeNavItem[];
}

export interface SidebarMode {
  /** A React hook: the mode's state. Called on every render of the column, the rail and the layout. */
  useMode(): ModeState;
  /**
   * Takes the rail's top slot (the last conversation's entry) while the mode is current; absent
   * = the slot stays the last conversation.
   */
  RailTop?: ComponentType;
  /** What the column lists while the mode is current: the drawer button's name. */
  listName(): string;
  /** A mark on the mode's option in the mode switch, and the words folded into its name. */
  badge?: { Node: ComponentType; name(): string };
}

export interface NavBadge {
  /** A React hook: what the anchor's dot says; null = no dot. */
  useNote?(): string | null;
  /** Drawn at the anchor's trailing edge in the pinned column (the rail has no room for it). */
  Mark?: ComponentType;
}
