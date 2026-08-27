/**
 * Manual order of the sidebar's GROUPS — the Workspace folders and the Agents the
 * conversation list is cut into (pure decisions, unit tested). The row-level counterpart
 * is session-order.ts, whose sequence algebra this module reuses rather than restates:
 * `orderWithinPinPartitions` renders the order, `moveInSequence` performs a drop, and
 * `readStringArray` / `writeStringArray` are the storage body. What differs is the key
 * namespace, which modes may be ordered, that there is no sort-mode switch — and how a
 * drop is committed (commitGroupOrder, below).
 *
 * - **Implicit mode.** Dragging a group IS the intent — there is no second toggle beside
 *   the rows' `recent | manual` one. A Project+mode with nothing stored keeps the
 *   automatic sort untouched (an empty order is the identity), so a fresh profile looks
 *   exactly as it did.
 * - **Workspace and Agent modes only.** The time mode's buckets are a fixed
 *   chronological ladder: putting the older bucket above the newer one is not an order
 *   anyone can mean. isOrderableGroupMode is the single gate — the store refuses to read
 *   or write for "time", so the exclusion cannot be undone by forgetting a check at one
 *   call site.
 * - **One array per Project AND grouping mode**, exactly like the rows: the modes cut
 *   the list into different groups, so one shared array would let a drag in one mode
 *   scramble the other.
 * - **Unknown keys go to the TOP**, keeping their automatic order among themselves —
 *   the rule the rows use for new Sessions, so a Workspace used for the first time or a
 *   freshly created Agent surfaces instead of hiding at the bottom of a long list.
 *
 * **Stale keys are inert, and nothing prunes them.** A stored key that matches no group
 * is only ever a failed membership lookup (applyManualOrder), so it costs a map entry
 * and changes nothing on screen. Pruning was tried at the drop and removed: deciding a
 * group is *gone* needs the mode's complete live key set, and the client cannot prove
 * one. In Workspace mode the per-Agent `workspaceCounts` look like such a proof but
 * describe only the rows the server's index knew at fetch time, so a Workspace whose
 * Sessions arrive later (a boot-time adoption, an import) can be absent from a
 * complete-looking picture; in Agent mode `agentsLoading === false` is not
 * proof of a *successful* fetch, and an empty Agent list is indistinguishable from a
 * failed one. A wrong proof silently discards an arrangement the user cannot restore,
 * which is a bad trade against a few hundred short strings in localStorage. If a group
 * ever comes back under the same key it resumes its old place, which is the honest
 * reading of "same key, same group".
 *
 * Ordering composes with the group pins the same way the rows compose with theirs: the
 * pinned cluster renders first and the manual order applies within the pinned cluster
 * and within the rest independently, so a drag can never pin or unpin a group.
 *
 * Storage is injectable (model-group-expansion.ts convention: vitest runs in Node, no
 * localStorage); malformed values degrade to the defaults.
 */
import {
  moveInSequence,
  orderWithinPinPartitions,
  readStringArray,
  writeStringArray,
} from "./session-order";
import type { SessionOrderStorage } from "./session-order";
import type { GroupMode } from "../components/ui/group-list";

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
  opts: { pinned: ReadonlySet<string>; order: readonly string[] },
): T[] {
  return orderWithinPinPartitions(groups, keyOf, opts.pinned, opts.order);
}

/**
 * Commits one group drop into the stored order, as a SPLICE rather than a rewrite.
 *
 * The rows' applyManualReorder moves the dropped partition's sequence to the FRONT of
 * the stored array, which is sound for Sessions because a partition is one group's own
 * list and the ids it displaces are read only within *other* partitions. That does not
 * lift to the group axis: a Workspace group exists only once one of its Sessions has
 * paged in, so the keys a group drop would displace are its own peers — not yet on
 * screen, but ordered against the very groups being committed. Front-loading demoted
 * every unloaded Workspace to the tail, and (because the two pin partitions share one
 * array) it also flung a group the length of the sidebar the moment it was pinned or
 * unpinned.
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
