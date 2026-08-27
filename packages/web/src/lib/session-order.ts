/**
 * Sort mode and manual order of the sidebar's conversation rows (pure decisions, unit
 * tested). Two settings work together:
 *
 * - Sort mode — "recent" (the default: rows keep the store's newest-first order) or
 *   "manual" (drag-reorderable). One global key like the grouping mode: a single user
 *   preference, not per Project.
 * - Manual order — one array of Session ids per Project AND grouping mode (the modes cut
 *   the same Sessions into different partitions, so one shared array would let a drag in
 *   one mode scramble the other). Only the RELATIVE order of ids that render together in
 *   one partition ever matters (rows are compared only within a group's own list), so a
 *   drop simply rewrites the affected partition's sequence to the front of the array
 *   (applyManualReorder) — the caller must commit the partition's FULL loaded sequence,
 *   not the display-capped slice, or the hidden rows would fall out and return as
 *   "newcomers". Rows not in the array — new Sessions — go to the TOP of their partition
 *   keeping their recency order; stored ids that no longer exist stay inert (membership
 *   lookups only) and deletion prunes via removeFromSessionOrder.
 *
 * Ordering composes with the row pins (pinned-sessions.ts): the pinned cluster always
 * renders first, and the manual order applies WITHIN the pinned cluster and within the
 * rest independently — dragging never pins or unpins (orderSessionRows).
 *
 * Storage is injectable (model-group-expansion.ts convention: vitest runs in Node, no
 * localStorage); malformed values degrade to the defaults.
 */
import { pinnedFirst } from "./session-grouping";
import type { GroupMode } from "../components/ui/group-list";

export type SessionSortMode = "recent" | "manual";

/** The single global key (`penguin.…` naming, GROUP_MODE_KEY convention); holds "manual" / "recent". */
export const SESSION_SORT_MODE_KEY = "penguin.sidebarSortMode";

/** Minimal storage interface (the subset of localStorage used here); tests inject an in-memory implementation. */
export interface SessionOrderStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Reads the persisted sort mode; only an explicit "manual" switches — anything else
 * (absent / unrecognized / throwing storage) is the "recent" default, so a fresh profile
 * looks unchanged. `localStorage` is resolved INSIDE the try, never as a default
 * parameter: merely touching it throws a SecurityError when site data is blocked (or in
 * a partitioned iframe), and this runs from a useState initializer — an escaping throw
 * would take the whole sidebar's first render down.
 */
export function initialSessionSortMode(storage?: SessionOrderStorage): SessionSortMode {
  try {
    const store = storage ?? localStorage;
    return store.getItem(SESSION_SORT_MODE_KEY) === "manual" ? "manual" : "recent";
  } catch {
    return "recent";
  }
}

export function storeSessionSortMode(mode: SessionSortMode, storage?: SessionOrderStorage): void {
  try {
    (storage ?? localStorage).setItem(SESSION_SORT_MODE_KEY, mode);
  } catch {
    /* best-effort persistence (quota limits / private browsing) */
  }
}

/**
 * Storage key of one Project's manual order (sidebar key-naming convention,
 * `penguin.pinnedSessions.<projectId>` &c.), scoped BY GROUPING MODE: the stored
 * sequence is only ever read within a partition, and the modes cut the same Sessions
 * into different partitions — one shared array would let a drag in one mode scramble
 * another mode's order.
 */
export const sessionOrderKey = (projectId: string, mode: GroupMode): string =>
  `penguin.sessionOrder.${projectId}.${mode}`;

/**
 * Reads a stored JSON string array, degrading to empty on anything unexpected: nothing
 * stored, malformed JSON, a non-array shape, or storage that throws. Junk elements are
 * dropped. `localStorage` is resolved INSIDE the try, never as a default parameter:
 * merely touching it throws a SecurityError when site data is blocked (or in a
 * partitioned iframe), and these run from useState initializers — an escaping throw
 * would take the sidebar's first render down. Shared with group-order.ts, which stores
 * the same shape under its own key namespace.
 */
export function readStringArray(key: string, storage?: SessionOrderStorage): string[] {
  try {
    const store = storage ?? localStorage;
    const parsed: unknown = JSON.parse(store.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Writes a JSON string array, best-effort (quota limits / private browsing fail silently). Shared with group-order.ts. */
export function writeStringArray(
  key: string,
  value: readonly string[],
  storage?: SessionOrderStorage,
): void {
  try {
    (storage ?? localStorage).setItem(key, JSON.stringify(value));
  } catch {
    /* best-effort persistence (quota limits / private browsing) */
  }
}

/** Reads a Project+mode's persisted manual order; no Project, nothing stored, or corrupted storage degrade to empty (pure recency). Junk array elements are dropped. (localStorage resolved inside the try — see initialSessionSortMode.) */
export function loadSessionOrder(
  projectId: string | null,
  mode: GroupMode,
  storage?: SessionOrderStorage,
): string[] {
  if (projectId === null) return [];
  return readStringArray(sessionOrderKey(projectId, mode), storage);
}

/** Writes a Project+mode's manual order on every drop (best-effort: quota limits / private browsing fail silently). */
export function saveSessionOrder(
  projectId: string | null,
  mode: GroupMode,
  order: readonly string[],
  storage?: SessionOrderStorage,
): void {
  if (projectId === null) return;
  writeStringArray(sessionOrderKey(projectId, mode), order, storage);
}

/**
 * Applies the stored manual order to one partition's rows: rows absent from the order
 * (new Sessions) come FIRST keeping their input (recency) order, then the listed rows
 * by their stored position. Stale stored ids simply match nothing.
 */
export function applyManualOrder<T>(
  rows: readonly T[],
  keyOf: (row: T) => string,
  order: readonly string[],
): T[] {
  if (order.length === 0) return [...rows];
  const pos = new Map(order.map((id, i) => [id, i]));
  const unlisted: T[] = [];
  const listed: T[] = [];
  for (const row of rows) (pos.has(keyOf(row)) ? listed : unlisted).push(row);
  listed.sort((a, b) => (pos.get(keyOf(a)) ?? 0) - (pos.get(keyOf(b)) ?? 0));
  return [...unlisted, ...listed];
}

/**
 * Applies a manual order WITHIN each pin partition: the pinned cluster renders first
 * (pinnedFirst), then the stored sequence is applied to the pinned cluster and to the
 * rest independently — so a drag can reorder but can never move an item across the pin
 * boundary. An empty `order` is the identity: the pinned-first list, untouched.
 *
 * The rows (orderSessionRows, below) and the sidebar's GROUPS (group-order.ts's
 * orderGroups) are the same operation one axis apart, so it lives here once. What
 * differs between them is upstream of this call — the rows sort by recency first and
 * gate on an explicit sort mode, the groups arrive in their own automatic order and have
 * no toggle — and that stays with each caller.
 */
export function orderWithinPinPartitions<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  pinned: ReadonlySet<string>,
  order: readonly string[],
): T[] {
  if (order.length === 0) return pinnedFirst(items, keyOf, pinned);
  // pinnedFirst's concat would be undone by the two filters below (it preserves input
  // order within each partition), so the manual path splits the input directly.
  const pin = items.filter((item) => pinned.has(keyOf(item)));
  const rest = items.filter((item) => !pinned.has(keyOf(item)));
  return [...applyManualOrder(pin, keyOf, order), ...applyManualOrder(rest, keyOf, order)];
}

/**
 * The full row-ordering pipeline of one group's active list:
 *
 * 1. recency — newest `recencyOf` first (the Session's `lastActiveAt`: 「最近更新」 means
 *    last ACTIVITY, not creation), ties broken by key descending to match the store's
 *    stable tiebreaker. Applied in both modes: it IS the recent mode's order, and in
 *    manual mode it is the order rows not yet in the stored sequence arrive in.
 * 2. the pinned cluster first (pinnedFirst), then
 * 3. under manual sort, the stored order within the pinned cluster and within the rest
 *    independently, so a drag can never move a row across the pin boundary.
 *
 * Only rows already FETCHED are ordered. The server still pages by `created_at DESC`
 * (listByAgent — there is no index on last_active_at), so a Session created long ago but
 * active today sits on a later page and cannot climb into the sidebar's first page until
 * "More" pulls that page in; fixing that needs a server-side ordering + index change.
 */
export function orderSessionRows<T>(
  rows: readonly T[],
  keyOf: (row: T) => string,
  opts: {
    pinned: ReadonlySet<string>;
    sortMode: SessionSortMode;
    order: readonly string[];
    /** Recency key of a row (the sidebar passes `lastActiveAt`). Omitted = keep the caller's order. */
    recencyOf?: (row: T) => string;
  },
): T[] {
  const recencyOf = opts.recencyOf;
  const byRecency = recencyOf
    ? [...rows].sort(
        (a, b) => recencyOf(b).localeCompare(recencyOf(a)) || keyOf(b).localeCompare(keyOf(a)),
      )
    : rows;
  // Recent mode passes an empty order, which is orderWithinPinPartitions's identity.
  return orderWithinPinPartitions(
    byRecency,
    keyOf,
    opts.pinned,
    opts.sortMode === "manual" ? opts.order : [],
  );
}

/**
 * Moves `dragId` next to `targetId` (after it when `after`, else before) in a displayed
 * sequence. Returns the INPUT array unchanged (same reference) for every no-op — a
 * missing id, a self-drop, or a drop that lands the row exactly where it already sat
 * (dropping just above your next neighbour) — so callers skip the state update and the
 * storage write instead of persisting a freshly allocated identical array.
 */
export function moveInSequence(
  sequence: readonly string[],
  dragId: string,
  targetId: string,
  after: boolean,
): readonly string[] {
  if (dragId === targetId || !sequence.includes(dragId)) return sequence;
  const without = sequence.filter((id) => id !== dragId);
  const at = without.indexOf(targetId);
  if (at < 0) return sequence;
  without.splice(after ? at + 1 : at, 0, dragId);
  return without.every((id, i) => id === sequence[i]) ? sequence : without;
}

/**
 * Commits one partition's displayed sequence into the stored order after a drop: the
 * sequence goes to the FRONT, the remaining stored ids follow unchanged. Correct
 * because only the relative order of ids that co-render in one partition is ever
 * read — ids of other groups keep their relative order among themselves.
 */
export function applyManualReorder(
  order: readonly string[],
  partitionSequence: readonly string[],
): string[] {
  const inPartition = new Set(partitionSequence);
  return [...partitionSequence, ...order.filter((id) => !inPartition.has(id))];
}

/** Prune on Session delete: drops the id, returning the INPUT array unchanged (same reference) when absent — callers skip the state update and storage write then. */
export function removeFromSessionOrder(
  order: readonly string[],
  sessionId: string,
): readonly string[] {
  return order.includes(sessionId) ? order.filter((id) => id !== sessionId) : order;
}
