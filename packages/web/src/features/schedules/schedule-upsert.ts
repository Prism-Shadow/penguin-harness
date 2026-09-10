/**
 * The request bodies the schedule surfaces send back to the server. PUT has whole-file
 * replace semantics, so flipping one field means resending every other field the file
 * holds — and a model reference is always the complete (provider, model_id) pair, never
 * half of one.
 */
import type {
  ModelRefDto,
  ScheduleItem,
  ScheduleUpsertRequest,
} from "@prismshadow/penguin-server/api";

/**
 * Stored schedule fields → a model reference. The DTO types the two fields independently, so
 * this guard is what keeps the form and the upsert body from ever assembling half a reference.
 * A file that sets only one half is rejected by the server when parsed (it surfaces under
 * invalidFiles, never as a listed row), so in practice this returns null only when the
 * schedule uses the Project's default model.
 */
export const itemModelRef = (
  item: Pick<ScheduleItem, "provider" | "modelId">,
): ModelRefDto | null =>
  item.modelId && item.provider ? { provider: item.provider, modelId: item.modelId } : null;

/** The item resent as it is, with only `enabled` set to the given value. */
export function toggleBody(item: ScheduleItem, enabled: boolean): ScheduleUpsertRequest {
  const model = itemModelRef(item);
  return {
    prompt: item.prompt,
    enabled,
    startAt: item.startAt,
    ...(item.period !== undefined ? { period: item.period } : {}),
    ...(item.endAt !== undefined ? { endAt: item.endAt } : {}),
    ...(item.sessionId !== undefined ? { sessionId: item.sessionId } : {}),
    ...(item.workspace !== undefined ? { workspace: item.workspace } : {}),
    ...(model ? { modelId: model.modelId, provider: model.provider } : {}),
  };
}
