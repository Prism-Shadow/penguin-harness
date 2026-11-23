/**
 * The model text generation runs on — `penguin tools t2t` and transcript editing alike: the
 * Project's `t2t` binding, and while nothing is bound to it, the Project's default chat model, so
 * both work as soon as the Project has a default. The fallback is this plugin's reading of its own
 * binding; the platform and core know nothing of it.
 */
import type { ModelBindings, ModelRef, ProjectModels } from "./host.js";

/** The text-generation model of a Project, and whether it is the default chat model standing in. */
export interface TextModel {
  model: ModelRef;
  /** No model is bound to `t2t`: the Project's default chat model is used. */
  followsDefault: boolean;
}

/** The binding key whose model text generation runs on. */
export const TEXT_BINDING = "t2t";

export async function textModel(
  bindings: ModelBindings,
  models: ProjectModels,
  projectId: string,
): Promise<TextModel | undefined> {
  const bound = await bindings.get(projectId, TEXT_BINDING);
  if (bound !== undefined) return { model: bound, followsDefault: false };
  const { defaultModel } = await models.getModels(projectId);
  return defaultModel !== undefined ? { model: defaultModel, followsDefault: true } : undefined;
}
