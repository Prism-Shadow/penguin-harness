/**
 * In-conversation model switch (the active Session's toolbar model picker): the decisions the
 * chat page makes, kept pure so they are testable without a DOM.
 *
 * The switch is not the `/model` handoff. `/model` opens a NEW conversation on another model
 * and leaves this one as it is; this picker keeps the conversation and moves it onto the
 * picked model. That compacts on the current model first (`POST …/switch-model` answers 202 and
 * streams an ordinary compaction row, then the new context's `session_meta`), except for a
 * Session that never ran, which has no context to compact and switches inside the request (200
 * with the updated Session). Only that `session_meta` says the Session moved: the stream model
 * turns it into a model-change marker, and the page moves its Session row to the model it
 * names (see sessionRowStale). When the summary cannot be had — the current model is
 * unavailable, or the compaction fails — the switch still completes, by Trace handoff: a
 * `[model_switch_from]` block naming this Session follows the meta, and the marker says so.
 * Only a stopped compaction streams no meta, and the Session then stays on its model.
 */
import type {
  ModelRefDto,
  ModelsResponse,
  SessionInfo,
  SessionStatus,
} from "@prismshadow/penguin-server/api";
import { modelCalledKeyless } from "@prismshadow/penguin-server/model-catalog";
import { groupShape } from "../models/connection";
import { hasConfiguredKey, sameModelRef } from "../models/model-grouping";
import { trailingCompaction } from "./thinking-level";
import type { ThinkingSwitchItem } from "./thinking-level";

/**
 * Whether the picker is disabled: a switch compacts, and the server neither starts nor queues a
 * compaction while a Task runs or another compaction is under way.
 */
export function sessionModelPickerDisabled(status: SessionStatus): boolean {
  return status === "running" || status === "compacting";
}

/**
 * What the switch will do to the context, read off the loaded transcript — the dialog and the
 * toast promise exactly that and no more:
 * - `"compact"` — there is conversation since the last compaction: the switch compacts it on
 *   the current model first, and the stream carries that compaction;
 * - `"empty"` — nothing at all yet: the switch is immediate (the server answers 200);
 * - `"compacted"` — the transcript ends in a completed compaction or a model switch with
 *   nothing said since: the server runs no compaction and streams no pair, and the
 *   conversation continues on the target from what that context opened with;
 * - `"handover"` — there is conversation to compact, but the current model is unavailable (no
 *   longer configured, or without a key on an endpoint that wants one): nothing is summarized,
 *   and the target gets the conversation's Trace file path instead.
 */
export type SwitchContextShape = "compact" | "empty" | "compacted" | "handover";

/**
 * Reads the shape off the transcript's end, the way the thinking switch's guard does (see
 * `trailingCompaction`), and off the configured models: `models` is the list the picker offers
 * (absent while it loads, which reads as available — the server decides either way). A row
 * with no key is available when its endpoint is one called without a key (an open MMSP or vLLM
 * server — the catalog's `modelCalledKeyless`, the rule the models page's key field uses).
 */
export function switchContextShape(
  items: ReadonlyArray<ThinkingSwitchItem>,
  current: ModelRefDto,
  models: Pick<ModelsResponse, "models" | "providers"> | null | undefined,
): SwitchContextShape {
  if (items.length === 0) return "empty";
  if (trailingCompaction(items).compacted) return "compacted";
  if (!models) return "compact";
  const entry = models.models.find((m) => sameModelRef(m, current));
  if (entry === undefined) return "handover";
  const keyless = modelCalledKeyless(
    {
      provider: entry.provider,
      modelId: entry.modelId,
      clientType: entry.clientType,
      baseUrl: entry.credential?.baseUrl,
    },
    groupShape(models.providers[entry.provider]),
  );
  return hasConfiguredKey(entry) || keyless ? "compact" : "handover";
}

/**
 * Whether the Session row on hand names another model than the conversation is on: the running
 * context's `session_meta` (the stream model's `contextModel`) is of this Session and says so —
 * a switch completed, on this tab or another one watching the Session, or the row was held from
 * before a switch. The page then moves the row to that model; the server moved its own before
 * it published the record. False while the stream says nothing of this Session's model: before
 * its history has loaded, and for the stream of a conversation the page has just left.
 */
export function sessionRowStale(
  contextModel: (ModelRefDto & { sessionId: string }) | null,
  row: Pick<SessionInfo, "sessionId" | "provider" | "modelId"> | null,
): boolean {
  return (
    contextModel !== null &&
    row !== null &&
    contextModel.sessionId === row.sessionId &&
    !sameModelRef(contextModel, row)
  );
}
