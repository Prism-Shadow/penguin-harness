import type { DragEvent as ReactDragEvent } from "react";
import type { SidebarDropTarget } from "@prismshadow/penguin-ui";
import {
  isNavPinned,
  storeNavGroupCollapsed,
  storeNavPinOverrides,
  withNavPinned,
  type NavEntryKey,
} from "../../lib/sidebar-nav-state";

import { loadSessionOrder } from "../../lib/session-order";
import { loadGroupOrder } from "./group-order";
import { storeGroupMode, type GroupMode } from "../../components/ui/group-list";

import { NAV_DRAG_MIME, isNavDrag, NavArea } from "../../lib/main-sidebar-persistence";
import type { useMainSidebarCanDrag } from "./main-sidebar-can-drag";

/** Consecutive live main statements 70..74, called once in original hook order. */
export function useMainSidebarSetGroupMode(scope: ReturnType<typeof useMainSidebarCanDrag>) {
  const {
    currentProjectId,
    navCollapsed,
    setNavCollapsed,
    navPins,
    setNavPins,
    navDrag,
    setNavDrag,
    navDropArea,
    setNavDropArea,
    setGroupModeState,
    setSessionOrder,
    setGroupOrder,
    canDrag,
    setGroupCaps,
    setGroupPage,
  } = scope;

  const setGroupMode = (mode: GroupMode) => {
    storeGroupMode(mode);
    setGroupModeState(mode);
    // The modes have unrelated group lists: go back to the first page, drop the per-group
    // reveal state (a cap keyed by an Agent id means nothing to a Workspace group), and
    // swap in this mode's own manual order (the stored sequence is read within partitions,
    // whose boundaries are exactly what the mode decides — one shared array would scramble).
    setSessionOrder(loadSessionOrder(currentProjectId, mode));
    setGroupOrder(loadGroupOrder(currentProjectId, mode));
    setGroupPage(0);
    setGroupCaps(new Map());
  };

  /** Collapse/expand the page-nav group (same store-then-set convention as setGroupMode). */
  const toggleNavGroup = () => {
    const next = !navCollapsed;
    storeNavGroupCollapsed(next);
    setNavCollapsed(next);
  };

  /**
   * Favourite or unfavourite one nav entry: the star and a drop across the areas both land here.
   * The entry simply takes its place in the other area; the star filling is the whole feedback,
   * with no reveal on the moved row (a de-blur there read as the row flickering).
   */
  const setNavPinned = (key: NavEntryKey, pinned: boolean) => {
    const next = withNavPinned(navPins, key, pinned);
    if (next === navPins) return;
    storeNavPinOverrides(next);
    setNavPins(next);
  };

  /**
   * Drag wiring of one development-mode nav entry: the row is its own handle. Offered only
   * where a pointer that can drag exists (HTML5 drag-and-drop never fires from touch); the
   * pin button is the way everywhere, and the only one there.
   */
  const navEntryDragProps = (key: NavEntryKey) =>
    canDrag
      ? {
          draggable: true,
          onDragStart: (e: ReactDragEvent) => {
            e.dataTransfer.setData(NAV_DRAG_MIME, key);
            e.dataTransfer.effectAllowed = "move";
            setNavDrag(key);
          },
          onDragEnd: () => {
            setNavDrag(null);
            setNavDropArea(null);
          },
        }
      : {};

  /**
   * Drop wiring of one nav area. Only a drag that would move the entry to this side is
   * accepted, so dropping a row back into its own area is not a drop at all; where inside the
   * area it lands is not asked, since both areas keep manifest order.
   */
  const navAreaDrop = (area: NavArea): SidebarDropTarget => ({
    over: navDropArea === area,
    onDragOver: (e) => {
      if (navDrag === null || !isNavDrag(e)) return;
      if (isNavPinned(navDrag, navPins) === (area === "pinned")) return;
      e.preventDefault();
      // The effect must be one effectAllowed permits, or the drop never fires (groupDragProps).
      e.dataTransfer.dropEffect = "move";
      setNavDropArea(area);
    },
    // Crossing onto one of the area's own rows fires dragleave too; still inside is no change.
    onDragLeave: (e) => {
      const to = e.relatedTarget;
      if (to instanceof Node && e.currentTarget.contains(to)) return;
      setNavDropArea((prev) => (prev === area ? null : prev));
    },
    onDrop: (e) => {
      if (navDrag === null || !isNavDrag(e)) return;
      e.preventDefault();
      setNavPinned(navDrag, area === "pinned");
      setNavDrag(null);
      setNavDropArea(null);
    },
  });
  return { ...scope, setGroupMode, toggleNavGroup, setNavPinned, navEntryDragProps, navAreaDrop };
}
