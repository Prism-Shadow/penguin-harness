import type { DragEvent as ReactDragEvent } from "react";
import { applyManualReorder, moveInSequence, saveSessionOrder } from "../../lib/session-order";
import { commitGroupOrder, isOrderableGroupMode, saveGroupOrder } from "./group-order";
import { GROUP_DRAG_MIME, isGroupDrag } from "../../lib/main-sidebar-persistence";
import type { useMainSidebarToggleGroup } from "./main-sidebar-toggle-group";

/** Consecutive live main statements 103..106, called once in original hook order. */
export function useMainSidebarCloseSearch(scope: ReturnType<typeof useMainSidebarToggleGroup>) {
  const {
    currentProjectId,
    groupMode,
    pinnedGroups,
    sessionOrder,
    setSessionOrder,
    groupOrder,
    setGroupOrder,
    setSearchOpen,
    setSearchQuery,
    canDrag,
    dragSession,
    dragGroup,
    setDragGroup,
    groupDropHint,
    setGroupDropHint,
    searching,
  } = scope;

  /** Close the search row and drop the filter (the toggle button, the clear ×, and Escape all land here). */
  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery("");
  };

  /**
   * Drop of a manual drag: commit the reordered partition sequence into the stored
   * order (the sequence moves to the array's front; only relative order within a
   * co-rendered partition is ever read, so other groups' ids are unaffected).
   */
  const commitManualDrop = (partitionIds: readonly string[], targetId: string, after: boolean) => {
    if (!dragSession) return;
    const seq = moveInSequence(partitionIds, dragSession.id, targetId, after);
    // Identity guard: a drop that changes nothing (self-drop, or landing where the row
    // already sat) must not rewrite and persist a fresh array.
    if (seq === partitionIds) return;
    const next = applyManualReorder(sessionOrder, seq);
    setSessionOrder(next);
    saveSessionOrder(currentProjectId, groupMode, next);
  };

  /**
   * Drop of a group drag: splice the dragged group in beside its target and persist.
   *
   * `sequence` is the mode's FULL rendered key list — every group of the mode, not the
   * page of groups on screen — and commitGroupOrder folds it into the stored array
   * where those groups already render, so a Workspace whose Sessions have not paged in
   * yet keeps its stored place instead of being pushed behind the ones that have.
   *
   * Nothing prunes here. Deciding a stored key is DEAD needs the mode's complete live
   * key set, and this component cannot prove one — the per-Workspace counts that look
   * like a proof are filtered by the "show CLI sessions" preference, and a settled Agent
   * fetch may simply have failed. Stale keys are inert (group-order.ts), so the cost of
   * keeping them is a map entry; the cost of a wrong proof is an arrangement the user
   * cannot get back.
   */
  const commitGroupDrop = (sequence: readonly string[], targetKey: string, after: boolean) => {
    if (dragGroup === null) return;
    const next = commitGroupOrder(groupOrder, sequence, dragGroup, targetKey, after);
    // Identity guard, as for rows: a drop that changes nothing must not persist a fresh array.
    if (next === groupOrder) return;
    setGroupOrder(next);
    saveGroupOrder(currentProjectId, groupMode, next);
  };

  /**
   * Drag-reorder wiring of one group header, given the mode's FULL ordered key list
   * (not the page of groups on screen — committing only the visible groups would drop
   * the hidden ones out of the stored sequence and bring them back as newcomers).
   *
   * Offered only where the groups have an order to change (isOrderableGroupMode: time
   * mode's buckets are a fixed chronological ladder), never on a search-filtered view,
   * and only where a pointer that can drag exists — HTML5 drag-and-drop never fires
   * from touch. A stored order still APPLIES on such a device: unlike the rows' global
   * sort mode, a group order is per Project and implicit, so there is nothing to
   * degrade — a phone renders the arrangement its owner made at a desk.
   *
   * A drop stays inside the dragged group's own pin partition, so dragging can reorder
   * but never pin or unpin (the rows' rule, one axis up).
   */
  const groupDragProps = (key: string, sequence: readonly string[]) => {
    if (!canDrag || searching || !isOrderableGroupMode(groupMode)) {
      return { header: {}, dropEdge: null as "above" | "below" | null };
    }
    const dragging = dragGroup;
    const samePartition =
      dragging !== null && dragging !== key && pinnedGroups.has(dragging) === pinnedGroups.has(key);
    /** Which half of the header the pointer is in — the edge the drop would land on. */
    const edgeOf = (e: ReactDragEvent) => {
      const rect = e.currentTarget.getBoundingClientRect();
      return e.clientY - rect.top > rect.height / 2;
    };
    return {
      header: {
        draggable: true,
        onDragStart: (e: ReactDragEvent) => {
          e.dataTransfer.setData(GROUP_DRAG_MIME, key);
          e.dataTransfer.effectAllowed = "move" as const;
          setDragGroup(key);
        },
        onDragEnd: () => {
          setDragGroup(null);
          setGroupDropHint(null);
        },
        onDragOver: (e: ReactDragEvent) => {
          if (!samePartition || !isGroupDrag(e)) return;
          e.preventDefault();
          // preventDefault alone only says "a drop may land here"; the effect still has
          // to be one effectAllowed permits, or a modifier held during the drag resolves
          // it to "none" and the drop event never fires (drop-zone.tsx sets it too).
          e.dataTransfer.dropEffect = "move";
          const after = edgeOf(e);
          setGroupDropHint((prev) =>
            prev?.key === key && prev.after === after ? prev : { key, after },
          );
        },
        // dragleave also fires when the pointer merely crosses onto one of the header's
        // OWN children — the collapse toggle spans most of the row, and up to three
        // action buttons follow it — so clearing unconditionally strobes the indicator.
        // relatedTarget is where the drag is going: still inside means nothing changed
        // (the idiom features/chat/drop-zone.tsx already uses).
        onDragLeave: (e: ReactDragEvent) => {
          const to = e.relatedTarget;
          if (to instanceof Node && e.currentTarget.contains(to)) return;
          setGroupDropHint((prev) => (prev?.key === key ? null : prev));
        },
        onDrop: (e: ReactDragEvent) => {
          if (!samePartition || dragging === null || !isGroupDrag(e)) return;
          e.preventDefault();
          // The FULL sequence, not the drag's pin partition: commitGroupOrder splices
          // within one array, and samePartition has already refused a cross-boundary
          // drop, so filtering here would only hide the other partition's keys from the
          // splice and cost them their stored positions.
          commitGroupDrop(sequence, key, edgeOf(e));
          setDragGroup(null);
          setGroupDropHint(null);
        },
      },
      dropEdge:
        samePartition && groupDropHint?.key === key
          ? groupDropHint.after
            ? ("below" as const)
            : ("above" as const)
          : null,
    };
  };
  return { ...scope, closeSearch, commitManualDrop, commitGroupDrop, groupDragProps };
}
