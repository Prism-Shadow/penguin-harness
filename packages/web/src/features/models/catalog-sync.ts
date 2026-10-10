/**
 * What 「同步新增模型」 / "Add new models" would add to a Project's model table: the built-in
 * catalog's presets the table does not carry.
 *
 * The add itself runs on the server (`POST …/models/sync-presets`, mode `add`), which also seeds
 * the promotions of the rows it adds. This module only answers the question the Models badge
 * and the header button are gated on, before anyone opens the page — so it has to be the
 * server's own rule, read off the same SAVED table: `presetModelEntries()` (every catalog row
 * that is not retired) minus the `(provider, model_id)` pairs already stored. A badge that leads
 * to a button which then answers "no new presets" is worse than no badge.
 *
 * Only additions count. A stored row whose price, context window, vision flag, name, protocol or
 * promotion differs from the catalog is not "out of date": any of those may be the user's own
 * edit, and nothing but 「恢复默认」, behind its confirmation, rewrites an existing row. A
 * preset the user deleted counts as new again, since adding it back is exactly what the button
 * does; retired catalog rows never count.
 */
import { presetModelEntries } from "@prismshadow/penguin-core/model-catalog";

/** What adding new presets would add (see {@link catalogDelta}). */
export interface CatalogDelta {
  added: number;
  /** `provider/modelId` of every preset that would be added, in catalog order. */
  refs: string[];
}

/** A saved model's paired reference, as the models endpoint sends it. */
interface ModelRef {
  provider: string;
  modelId: string;
}

/**
 * The presets the saved table lacks. `refs` is what a dismissal is stamped against, so a later
 * catalog release adding a different model raises the badge again (see `lib/todo-badges.ts`).
 */
export function catalogDelta(
  models: readonly ModelRef[],
  preset: ReadonlyArray<{ provider: string; model_id: string }> = presetModelEntries(),
): CatalogDelta {
  const saved = new Set(models.map((m) => `${m.provider}\0${m.modelId}`));
  const refs = preset
    .filter((p) => !saved.has(`${p.provider}\0${p.model_id}`))
    .map((p) => `${p.provider}/${p.model_id}`);
  return { added: refs.length, refs };
}
