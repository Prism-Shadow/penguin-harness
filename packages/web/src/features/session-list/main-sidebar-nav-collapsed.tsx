import { useRef, useState } from "react";
import {
  initialNavGroupCollapsed,
  initialNavPinOverrides,
  type NavEntryKey,
} from "../../lib/sidebar-nav-state";

import { NavArea } from "../../lib/main-sidebar-persistence";
import type { useMainSidebarSessions } from "./main-sidebar-sessions";

/** Consecutive live main statements 30..36, called once in original hook order. */
export function useMainSidebarNavCollapsed(scope: ReturnType<typeof useMainSidebarSessions>) {
  const { navPagesOf, useWebAppPages } = scope;

  /** Folded collapsible nav area (company mode: the whole nav group); expanded by default, the choice persists across sessions. */
  const [navCollapsed, setNavCollapsed] = useState(initialNavGroupCollapsed);
  /** The main nav's pages, as the modules contributed them (web-app/page-table.ts). */
  const navPages = navPagesOf(useWebAppPages());
  /** The user's changes to which nav entries are pinned (the defaults live in nav-state.ts); persisted like the fold. */
  const [navPins, setNavPins] = useState(() => initialNavPinOverrides(navPages));
  /** Nav entry being dragged across the areas, and the area a drop would move it into. */
  const [navDrag, setNavDrag] = useState<NavEntryKey | null>(null);
  const [navDropArea, setNavDropArea] = useState<NavArea | null>(null);
  /**
   * The entry whose pin button takes focus once its row re-mounts in the other area. Moving
   * an entry moves its row to another container, and the button that had focus goes with the
   * old one — a keyboard user would be dropped onto <body>.
   */
  const pinFocusRef = useRef<NavEntryKey | null>(null);
  /** The chevron toggle: where focus goes when the moved row lands in the folded area. */
  const navToggleRef = useRef<HTMLButtonElement | null>(null);
  return {
    ...scope,
    navCollapsed,
    setNavCollapsed,
    navPages,
    navPins,
    setNavPins,
    navDrag,
    setNavDrag,
    navDropArea,
    setNavDropArea,
    pinFocusRef,
    navToggleRef,
  };
}
