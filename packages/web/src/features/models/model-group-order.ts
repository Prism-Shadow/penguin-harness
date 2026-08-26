/**
 * Manual order of the models page's provider GROUPS: where the arrangement is stored, and
 * the two halves of the rule that reads and writes it.
 *
 * The page renders provider groups in the built-in catalog's order (model-grouping.ts).
 * That order is a curated default, not everyone's: a user who only ever reaches for two
 * providers can drag those groups to the top and leave the rest below. Dragging IS the
 * intent — there is no sort toggle and no pinning, so a Project with nothing stored
 * renders exactly the catalog order it always did (an empty order is the identity).
 *
 * - **One array per Project**, keyed like its neighbour `penguin.modelsExpandedGroups`
 *   — the model table is per Project, so the arrangement of its groups is too.
 * - **Unplaced groups TRAIL**, keeping their automatic order among themselves. This is
 *   the opposite of the sidebar's rule (session-order.ts's applyManualOrder surfaces an
 *   unplaced group so a Workspace used for the first time is not lost at the bottom of a
 *   long list), and the difference is what an unplaced group MEANS on each side. Here it
 *   is almost always one the user just created, through a control that sits below every
 *   group: a new group that jumps to the top leaves the part of the page being looked at.
 *   Trailing is also what the automatic order already does — user-defined groups follow
 *   the built-in ones.
 * - **A drop commits against every group the library could show**, empty built-ins
 *   included (`allGroupKeys`), not the groups currently on screen. groupModelRows drops
 *   a built-in group holding no models, so committing only what renders would leave the
 *   empty ones unplaced and make each one a newcomer the day a model is added to it.
 * - **Stale keys are inert, and nothing prunes them.** A key matching no group is only
 *   a failed membership lookup. A provider that leaves the catalog and returns resumes
 *   its place, which is the honest reading of "same key, same group"; the cost of
 *   keeping it is one map entry.
 *
 * orderModelGroups and commitModelGroupOrder are one rule stated twice — where an
 * unplaced group renders, and where a drop writes it — so they live side by side: a drop
 * that materialised unplaced groups at the other end would shove groups the user never
 * touched. The splice itself is session-order.ts's `moveInSequence`, including its
 * identity return for a drop that moves nothing.
 *
 * Storage is injectable (model-group-expansion.ts convention: vitest runs in Node, no
 * localStorage); malformed values degrade to an empty order, i.e. the catalog sequence.
 */
import { moveInSequence, readStringArray, writeStringArray } from "../../lib/session-order";
import type { SessionOrderStorage } from "../../lib/session-order";

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
