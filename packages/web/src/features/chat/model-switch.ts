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
 * names (see sessionRowStale). A compaction that fails streams no meta, and the Session stays
 * on the model it was on.
 */
import type { ModelRefDto, SessionInfo, SessionStatus } from "@prismshadow/penguin-server/api";
import { sameModelRef } from "../models/model-grouping";
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
 * - `"compacted"` — the transcript ends in a completed compaction with nothing said since: the
 *   server runs no compaction and streams no summarize pair, the conversation continues on the
 *   target from what that compaction left (a switch right after a switch closes the untouched
 *   context with a discard pair — housekeeping, not a compaction of anything).
 */
export type SwitchContextShape = "compact" | "empty" | "compacted";

/** Reads the shape off the transcript's end, the way the thinking switch's guard does (see `trailingCompaction`). */
export function switchContextShape(items: ReadonlyArray<ThinkingSwitchItem>): SwitchContextShape {
  if (items.length === 0) return "empty";
  return trailingCompaction(items).compacted ? "compacted" : "compact";
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
