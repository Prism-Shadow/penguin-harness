/**
 * Manual order of the sidebar's GROUPS — the Workspace folders and the Agents the
 * conversation list is cut into (pure decisions, unit tested). The row-level
 * counterpart is session-order.ts, whose sequence algebra (applyManualOrder,
 * moveInSequence, applyManualReorder) this module reuses rather than restates; what
 * differs is the key namespace, which modes may be ordered, and that there is no
 * sort-mode switch:
 *
 * - **Implicit mode.** Dragging a group IS the intent — there is no second toggle
 *   beside the rows' `recent | manual` one. A Project+mode with nothing stored keeps
 *   the automatic sort untouched (an empty order is the identity), so a fresh profile
 *   looks exactly as it did.
 * - **Workspace and Agent modes only.** The time mode's buckets are last day / last
 *   month / older: a fixed chronological ladder where "put 上个月 above 最近一天" is
 *   not an order anyone can mean. isOrderableGroupMode is the single gate — the store
 *   refuses to read or write for "time", so the exclusion cannot be undone by
 *   forgetting a check at one call site.
 * - **One array per Project AND grouping mode**, exactly like the rows: the modes cut
 *   the list into different groups, so one shared array would let a drag in one mode
 *   scramble the other.
 * - **Unknown keys go to the TOP**, keeping their automatic order among themselves —
 *   the rule the rows use for new Sessions, so a Workspace used for the first time or
 *   a freshly created Agent surfaces instead of hiding at the bottom of a long list.
 *   The merged temporary-workspace group is not special here: its key is stable, so it
 *   stores like any other and its forced-last position is only the default the
 *   automatic sort supplies before any drag.
 * - **Stale keys stay inert** (membership lookups only) and pruneGroupOrder drops them
 *   once the live set is known for certain.
 *
 * Ordering composes with the group pins the same way the rows compose with theirs: the
 * pinned cluster renders first and the manual order applies within the pinned cluster
 * and within the rest independently, so a drag can never pin or unpin a group.
 *
 * Storage is injectable (model-group-expansion.ts convention: vitest runs in Node, no
 * localStorage); malformed values degrade to the defaults.
 */
import { pinnedFirst } from "./session-grouping";
import { applyManualOrder } from "./session-order";
import type { SessionOrderStorage } from "./session-order";
import type { GroupMode } from "../components/ui/group-list";

/**
 * The grouping modes whose groups can be dragged into a manual order. "time" is
 * deliberately absent — see the header.
 */
export const ORDERABLE_GROUP_MODES = ["workspace", "agent"] as const;
export type OrderableGroupMode = (typeof ORDERABLE_GROUP_MODES)[number];

/** Whether a grouping mode's groups may be reordered at all (the one gate; time mode is excluded). */
export function isOrderableGroupMode(mode: GroupMode): mode is OrderableGroupMode {
  return mode === "workspace" || mode === "agent";
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
 * (localStorage is resolved INSIDE the try, never as a default parameter: merely
 * touching it throws a SecurityError when site data is blocked, and this runs from a
 * useState initializer — an escaping throw would take the sidebar's first render down.)
 */
export function loadGroupOrder(
  projectId: string | null,
  mode: GroupMode,
  storage?: GroupOrderStorage,
): string[] {
  if (projectId === null || !isOrderableGroupMode(mode)) return [];
  try {
    const store = storage ?? localStorage;
    const parsed: unknown = JSON.parse(store.getItem(groupOrderKey(projectId, mode)) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Writes a Project+mode's manual group order on every drop; an unorderable mode writes nothing (best-effort otherwise: quota limits / private browsing fail silently). */
export function saveGroupOrder(
  projectId: string | null,
  mode: GroupMode,
  order: readonly string[],
  storage?: GroupOrderStorage,
): void {
  if (projectId === null || !isOrderableGroupMode(mode)) return;
  try {
    (storage ?? localStorage).setItem(groupOrderKey(projectId, mode), JSON.stringify(order));
  } catch {
    /* best-effort persistence (quota limits / private browsing) */
  }
}

/**
 * The group-ordering pipeline, mirroring orderSessionRows one axis up:
 *
 * 1. the caller's automatic order arrives as the input (Workspace groups by their
 *    newest Session with the temp group forced last, Agents in their configured
 *    order) — it decides where groups with no stored place sit, and IS the whole
 *    answer while nothing is stored;
 * 2. the pinned cluster first (pinnedFirst), then
 * 3. the stored order within the pinned cluster and within the rest independently, so
 *    a drag can never move a group across the pin boundary.
 *
 * An empty `order` returns the pinned-first list unchanged, which is exactly what the
 * sidebar rendered before any group was ever dragged.
 */
export function orderGroups<T>(
  groups: readonly T[],
  keyOf: (group: T) => string,
  opts: { pinned: ReadonlySet<string>; order: readonly string[] },
): T[] {
  const byPin = pinnedFirst(groups, keyOf, opts.pinned);
  if (opts.order.length === 0) return byPin;
  const pin = byPin.filter((g) => opts.pinned.has(keyOf(g)));
  const rest = byPin.filter((g) => !opts.pinned.has(keyOf(g)));
  return [
    ...applyManualOrder(pin, keyOf, opts.order),
    ...applyManualOrder(rest, keyOf, opts.order),
  ];
}

/**
 * Prune on group destruction (a Workspace losing its last Session, a deleted Agent):
 * drops every stored key outside `live`, returning the INPUT array unchanged (same
 * reference) when there is nothing to drop — callers skip the state update and the
 * storage write then.
 *
 * `live` must be the mode's COMPLETE key set, not the keys currently on screen: the
 * group list is display-capped and Workspace groups appear as their Agents' counts
 * arrive, so pruning against a partial picture would throw away the stored position of
 * a group that has merely not loaded yet, and it would come back as a newcomer.
 */
export function pruneGroupOrder(
  order: readonly string[],
  live: ReadonlySet<string>,
): readonly string[] {
  return order.every((key) => live.has(key)) ? order : order.filter((key) => live.has(key));
}
