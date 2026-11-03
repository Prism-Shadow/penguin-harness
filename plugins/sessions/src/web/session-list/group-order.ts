import {
  moveInSequence,
  orderWithinPinPartitions,
  readStringArray,
  writeStringArray,
  type SessionOrderStorage,
} from "../../lib/session-order";

import type { GroupMode } from "../../components/ui/group-list";

/**
 * The grouping modes whose groups can be dragged into a manual order. "time" is
 * deliberately absent — see the header.
 *
 * Deliberately NOT the same declaration as group-list.ts's `TreeGroupMode`, which names
 * the same two modes: that one exists because a Trace-file tree's rows carry no activity
 * timestamp to bucket on, this one because the time buckets are an order nobody can
 * mean. Same set today, different reasons — folding them together would let a change to
 * what a Traces tree can group by silently redefine what the sidebar may store.
 */
export const ORDERABLE_GROUP_MODES = ["workspace", "agent"] as const;
export type OrderableGroupMode = (typeof ORDERABLE_GROUP_MODES)[number];

/**
 * Whether a grouping mode's groups may be reordered at all (the one gate; time mode is
 * excluded). Derived from the list rather than restating it — a hand-written `||` chain
 * lets the exported array and "the single gate" drift, which is the exact failure this
 * gate exists to prevent.
 */
export function isOrderableGroupMode(mode: GroupMode): mode is OrderableGroupMode {
  return (ORDERABLE_GROUP_MODES as readonly GroupMode[]).includes(mode);
}

/** Minimal storage interface, shared with session-order.ts; tests inject an in-memory implementation. */
export type GroupOrderStorage = SessionOrderStorage;

/**
 * Storage key of one Project's manual GROUP order (sidebar key-naming convention,
 * `penguin.sessionOrder.<projectId>.<mode>` &c.), scoped by grouping mode for the same
 * reason the row order is: the modes have unrelated group lists.
 */
export const groupOrderKey = (projectId: string, mode: OrderableGroupMode): string =>
  `penguin.groupOrder.${projectId}.${mode}`;

/**
 * Reads a Project+mode's manual group order. No Project, an unorderable mode, nothing
 * stored, or corrupted storage all degrade to empty — which is the identity for
 * orderGroups, i.e. today's automatic sort. Junk array elements are dropped.
 */
export function loadGroupOrder(
  projectId: string | null,
  mode: GroupMode,
  storage?: GroupOrderStorage,
): string[] {
  if (projectId === null || !isOrderableGroupMode(mode)) return [];
  return readStringArray(groupOrderKey(projectId, mode), storage);
}

/** Writes a Project+mode's manual group order on every drop; an unorderable mode writes nothing. */
export function saveGroupOrder(
  projectId: string | null,
  mode: GroupMode,
  order: readonly string[],
  storage?: GroupOrderStorage,
): void {
  if (projectId === null || !isOrderableGroupMode(mode)) return;
  writeStringArray(groupOrderKey(projectId, mode), order, storage);
}

/**
 * The group-ordering pipeline, mirroring orderSessionRows one axis up:
 *
 * 1. the caller's automatic order arrives as the input (Workspace groups by their newest
 *    Session with the temp group forced last, Agents in their configured order) — it
 *    decides where groups with no stored place sit, and IS the whole answer while
 *    nothing is stored;
 * 2. the pinned cluster first, then the stored order within the pinned cluster and
 *    within the rest independently (orderWithinPinPartitions), so a drag can never move
 *    a group across the pin boundary.
 *
 * An empty `order` returns the pinned-first list unchanged, which is exactly what the
 * sidebar rendered before any group was ever dragged.
 */
export function orderGroups<T>(
  groups: readonly T[],
  keyOf: (group: T) => string,
  opts: {
    pinned: ReadonlySet<string>;
    order: readonly string[];
  },
): T[] {
  return orderWithinPinPartitions(groups, keyOf, opts.pinned, opts.order);
}

/**
 * Commits one group drop into the stored order, as a SPLICE rather than a rewrite.
 *
 * The rows' applyManualReorder moves the dropped partition's sequence to the FRONT of
 * the stored array, which is sound for Sessions because a partition is one group's own
 * list and the ids it displaces are read only within *other* partitions. That does not
 * lift to the group axis: the Workspace sequence is only as complete as the last counts
 * fetch (a Workspace whose Sessions arrive later is absent until the next reload), so
 * the keys a group drop would displace can be peers not on screen, ordered against the
 * very groups being committed. Front-loading demoted every such Workspace to the tail,
 * and (because the two pin partitions share one array) it also flung a group the length
 * of the sidebar the moment it was pinned or unpinned.
 *
 * So: materialise the rendered keys into the stored array where they already RENDER —
 * unlisted ones at the front, which is where applyManualOrder puts them — then move the
 * dragged key next to its target inside that array. Keys that are stored but not
 * rendered keep their positions relative to everything else, so a group that has merely
 * not loaded comes back exactly where the user left it.
 *
 * Returns the INPUT array unchanged (same reference) when the drop moves nothing, so the
 * caller can skip the state update and the storage write.
 */
export function commitGroupOrder(
  order: readonly string[],
  rendered: readonly string[],
  dragKey: string,
  targetKey: string,
  after: boolean,
): readonly string[] {
  const stored = new Set(order);
  const materialised = [...rendered.filter((key) => !stored.has(key)), ...order];
  const next = moveInSequence(materialised, dragKey, targetKey, after);
  // moveInSequence hands back its input for every no-op (self-drop, missing key, or a
  // landing that changes nothing): nothing moved, so nothing is worth persisting.
  return next === materialised ? order : next;
}
