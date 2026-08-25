/**
 * Manual order of the models page's provider GROUPS — the storage half; the sequence
 * algebra is shared, not restated.
 *
 * The page renders provider groups in the built-in catalog's order (model-grouping.ts).
 * That order is a curated default, not everyone's: a user who only ever reaches for two
 * providers can drag those groups to the top and leave the rest below. Dragging IS the
 * intent — there is no sort toggle and no pinning, so a Project with nothing stored
 * renders exactly the catalog order it always did (an empty order is the identity).
 *
 * - **One array per Project**, keyed like its neighbour `penguin.modelsExpandedGroups`
 *   — the model table is per Project, so the arrangement of its groups is too.
 * - **Unknown keys go to the TOP**, keeping their catalog order among themselves
 *   (session-order.ts's applyManualOrder): a provider group used for the first time
 *   surfaces instead of hiding at the bottom of a long page.
 * - **A drop commits against every group the library could show**, empty built-ins
 *   included (`allGroupKeys`), not the groups currently on screen. groupModelRows drops
 *   a built-in group holding no models, so committing only what renders would leave the
 *   empty ones unplaced and make each one a newcomer the day a model is added to it.
 * - **Stale keys are inert, and nothing prunes them.** A key matching no group is only
 *   a failed membership lookup. A provider that leaves the catalog and returns resumes
 *   its place, which is the honest reading of "same key, same group"; the cost of
 *   keeping it is one map entry.
 *
 * `commitGroupOrder` is the sidebar's group-drop splice (lib/group-order.ts) used
 * verbatim: materialise the rendered keys into the stored array where they already sit,
 * then move the dragged key beside its target. Its no-op identity return is what lets a
 * drop that changes nothing skip both the state update and the storage write.
 *
 * Storage is injectable (model-group-expansion.ts convention: vitest runs in Node, no
 * localStorage); malformed values degrade to an empty order, i.e. the catalog sequence.
 */
import { readStringArray, writeStringArray } from "../../lib/session-order";
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
