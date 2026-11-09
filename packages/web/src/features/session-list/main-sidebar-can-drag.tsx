import { useEffect, useState } from "react";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { loadPinnedSessions } from "./pinned-sessions";
import { loadWorkspaceRegistry } from "./workspace-registry";
import { loadSessionOrder } from "../../lib/session-order";
import { loadGroupOrder } from "./group-order";
import { useDraftSessions, type DraftSessionEntry } from "../chat";

import { DRAG_POINTER_QUERY, loadGroupSet } from "../../lib/main-sidebar-persistence";
import type { useMainSidebarSearchOpen } from "./main-sidebar-search-open";

/** Consecutive live main statements 58..76, called once in original hook order. */
export function useMainSidebarCanDrag(scope: ReturnType<typeof useMainSidebarSearchOpen>) {
  const {
    user,
    currentProjectId,
    collapseStoreKey,
    pinStoreKey,
    groupMode,
    setCollapsedGroups,
    setPinnedGroups,
    setPinnedSessions,
    setSessionOrder,
    setGroupOrder,
    setRegisteredWorkspaces,
  } = scope;

  /**
   * Whether a pointer that can drag is present (the outline rail's HOVER_QUERY idiom).
   * HTML5 drag-and-drop never fires from touch, and the sort mode is one GLOBAL
   * preference: offering 手动排序 in the mobile drawer would freeze that list in an
   * order the phone has no gesture to change — and flip the desktop too. The option is
   * hidden there; an already-stored "manual" degrades to recency on such a device.
   */
  const [canDrag, setCanDrag] = useState(() => window.matchMedia(DRAG_POINTER_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(DRAG_POINTER_QUERY);
    const onChange = (e: MediaQueryListEvent) => setCanDrag(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  /** Row being dragged (manual sort only) and the current drop hint (target row + which edge). */
  const [dragSession, setDragSession] = useState<{ scope: string; id: string } | null>(null);
  const [dropHint, setDropHint] = useState<{ id: string; after: boolean } | null>(null);
  /** Group header being dragged (its key) and the current group drop hint (target group + which edge). */
  const [dragGroup, setDragGroup] = useState<string | null>(null);
  const [groupDropHint, setGroupDropHint] = useState<{ key: string; after: boolean } | null>(null);
  /** "More" rows with a fetch in flight, keyed by group key — the row disables and reads "loading" so a page that lands entirely in other groups still visibly did something. */
  const [pendingLoads, setPendingLoads] = useState<ReadonlySet<string>>(new Set());
  /** Per-group display cap (keyed by group key; absent = SIDEBAR_PAGE_SIZE). "More" raises it a page at a time. */
  const [groupCaps, setGroupCaps] = useState<ReadonlyMap<string, number>>(new Map());
  /** Which PAGE of groups renders (#139: dozens of Agents/Workspaces made the list too tall to scan), 0-based; reset per Project and on a mode switch, and clamped at render to the pages that still exist. */
  const [groupPage, setGroupPage] = useState(0);
  // Reset the Project's persisted groups before its first commit, not in an effect.
  const [setsFor, setSetsFor] = useState(currentProjectId);
  if (setsFor !== currentProjectId) {
    setSetsFor(currentProjectId);
    setCollapsedGroups(loadGroupSet(collapseStoreKey));
    setPinnedGroups(loadGroupSet(pinStoreKey));
    setPinnedSessions(loadPinnedSessions(currentProjectId));
    setSessionOrder(loadSessionOrder(currentProjectId, groupMode));
    setGroupOrder(loadGroupOrder(currentProjectId, groupMode));
    setRegisteredWorkspaces(loadWorkspaceRegistry(currentProjectId));
    setGroupPage(0);
    // The other Project's groups are gone, and so is any meaning their reveal state had.
    setGroupCaps(new Map());
  }
  /** Session pending delete confirmation (null = none). */
  const [deletingSession, setDeletingSession] = useState<SessionInfo | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  /** Parked draft conversation pending delete confirmation (null = none). */
  const [deletingDraft, setDeletingDraft] = useState<DraftSessionEntry | null>(null);
  /** Parked draft conversations of this user × Project, newest first (reactive module store). */
  const draftEntries = useDraftSessions(user?.userId ?? null, currentProjectId);
  /** Session currently being renamed (null = none) and the title being typed. */
  const [renamingSession, setRenamingSession] = useState<SessionInfo | null>(null);
  const [renameText, setRenameText] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  /** Session whose messaging-binding dialog is open (null = none). */
  const [messagingSession, setMessagingSession] = useState<SessionInfo | null>(null);
  return {
    ...scope,
    canDrag,
    setCanDrag,
    dragSession,
    setDragSession,
    dropHint,
    setDropHint,
    dragGroup,
    setDragGroup,
    groupDropHint,
    setGroupDropHint,
    pendingLoads,
    setPendingLoads,
    groupCaps,
    setGroupCaps,
    groupPage,
    setGroupPage,
    deletingSession,
    setDeletingSession,
    deletingBusy,
    setDeletingBusy,
    deletingDraft,
    setDeletingDraft,
    draftEntries,
    renamingSession,
    setRenamingSession,
    renameText,
    setRenameText,
    renameBusy,
    setRenameBusy,
    renameError,
    setRenameError,
    messagingSession,
    setMessagingSession,
  };
}
