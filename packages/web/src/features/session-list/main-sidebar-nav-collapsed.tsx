import { useMemo, useRef, useState } from "react";
import {
  initialModeNavPinOverrides,
  initialNavGroupCollapsed,
  initialNavPinOverrides,
  type ModeNavPinOverrides,
  type NavEntryKey,
} from "../../lib/sidebar-nav-state";

import { NavArea } from "../../lib/main-sidebar-persistence";
import type { useMainSidebarSessions } from "./main-sidebar-sessions";

/** Consecutive live main statements 30..36, called once in original hook order. */
export function useMainSidebarNavCollapsed(scope: ReturnType<typeof useMainSidebarSessions>) {
  const { navPagesOf, useWebAppPages, inCompany, modeKey } = scope;

  /** Folded collapsible nav area, one choice for every mode; expanded by default, the choice persists across sessions. */
  const [navCollapsed, setNavCollapsed] = useState(initialNavGroupCollapsed);
  /** The main nav's pages, as the modules contributed them (web-app/page-table.ts). */
  const navPages = navPagesOf(useWebAppPages());
  /** The user's changes to which nav entries are pinned (the defaults live in nav-state.ts); persisted like the fold. */
  const [navPins, setNavPins] = useState(() => initialNavPinOverrides(navPages));
  /**
   * A contributed mode's pin choices (company mode's), by mode, once changed here; a mode not in
   * it reads its stored choices. Kept apart: a star in one mode never moves an entry in another.
   */
  const [modeNavPinsByMode, setModeNavPinsByMode] = useState<
    Readonly<Record<string, ModeNavPinOverrides>>
  >({});
  /** The current mode's choices; development mode's are `navPins`. */
  const modeNavPins = useMemo(
    () => (inCompany ? (modeNavPinsByMode[modeKey] ?? initialModeNavPinOverrides(modeKey)) : {}),
    [inCompany, modeKey, modeNavPinsByMode],
  );
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
    modeNavPins,
    setModeNavPinsByMode,
    navDrag,
    setNavDrag,
    navDropArea,
    setNavDropArea,
    pinFocusRef,
    navToggleRef,
  };
}
