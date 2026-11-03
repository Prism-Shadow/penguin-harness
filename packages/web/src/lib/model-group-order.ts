<<<<<<< HEAD:packages/web/src/lib/model-group-order.ts
} from "./session-order";
|||||||| parent of c87e240ae8 (b4a: move models group (routes, balance/oauth/modelscope services, models web) to plugins/models):packages/web/src/features/models/model-group-order.ts
} from "../../lib/session-order";
========
} from "@prismshadow/penguin-web/internal";


/** Minimal storage interface, shared with session-order.ts; tests inject an in-memory implementation. */
export type ModelGroupOrderStorage = SessionOrderStorage;

/** Storage key of one Project's manual group order (`penguin.modelsExpandedGroups.<projectId>` naming convention). */
export const modelGroupOrderKey = (projectId: string): string =>
  `penguin.modelsGroupOrder.${projectId}`;

/**
 * Reads a Project's manual group order. No Project, nothing stored, or corrupted storage
 * all degrade to empty — the identity for groupModelRows, i.e. the catalog order. Junk
 * array elements are dropped.
 */
export function loadModelGroupOrder(
  projectId: string | null,
  storage?: ModelGroupOrderStorage,
): string[] {
  if (projectId === null) return [];
  return readStringArray(modelGroupOrderKey(projectId), storage);
}

/** Writes a Project's manual group order on every drop; no Project writes nothing. */
export function saveModelGroupOrder(
  projectId: string | null,
  order: readonly string[],
  storage?: ModelGroupOrderStorage,
): void {
  if (projectId === null) return;
  writeStringArray(modelGroupOrderKey(projectId), order, storage);
}

/**
 * Applies a stored order to the library's groups: the groups it names take its sequence,
 * the groups it does not keep their automatic (catalog) order and follow at the END. An
 * empty order is the identity — the automatic order, untouched.
 */
export function orderModelGroups<T>(
  groups: readonly T[],
  keyOf: (group: T) => string,
  order: readonly string[],
): T[] {
  if (order.length === 0) return [...groups];
  const pos = new Map(order.map((key, i) => [key, i]));
  const placed: T[] = [];
  const unplaced: T[] = [];
  for (const group of groups) (pos.has(keyOf(group)) ? placed : unplaced).push(group);
  placed.sort((a, b) => (pos.get(keyOf(a)) ?? 0) - (pos.get(keyOf(b)) ?? 0));
  return [...placed, ...unplaced];
}

/**
 * Commits one drop into the stored order, as a SPLICE rather than a rewrite: materialise
 * every group key into the stored array where it already RENDERS — placed ones from the
 * order, the rest trailing, matching orderModelGroups — then move the dragged key beside
 * its target. Keys that are stored but no longer name a group keep their positions
 * relative to everything else.
 *
 * `all` is every group the library could show (allGroupKeys), not the groups on screen:
 * a built-in provider holding no models is not rendered, and leaving it out would make it
 * a newcomer the day a model is added to it.
 *
 * Returns the INPUT array unchanged (same reference) when the drop moves nothing, so the
 * caller can skip the state update and the storage write.
 */
export function commitModelGroupOrder(
  order: readonly string[],
  all: readonly string[],
  dragKey: string,
  targetKey: string,
  after: boolean,
): readonly string[] {
  const stored = new Set(order);
  const materialised = [...order, ...all.filter((key) => !stored.has(key))];
  const next = moveInSequence(materialised, dragKey, targetKey, after);
  // moveInSequence hands back its input for every no-op (self-drop, missing key, or a
  // landing that changes nothing): nothing moved, so nothing is worth persisting.
  return next === materialised ? order : next;
}
